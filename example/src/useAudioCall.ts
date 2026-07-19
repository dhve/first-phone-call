/**
 * The audio phone call state machine.
 *
 *   idle -> dialing -> active -> idle          (we call them)
 *   idle -> ringing -> active -> idle          (they call us)
 *
 * Inside `active` a strict turn discipline holds: the caller speaks first
 * after accept, and each side sends its next turn only after fully processing
 * the peer's last one. Processing a received turn means: download the WAV
 * once, play it and transcribe it CONCURRENTLY, run the LLM on the
 * transcription, and send the reply only after both the LLM is done and the
 * speaker has gone quiet. Whisper and llama never run at the same moment; the
 * sequential handler gives that for free and it must stay that way, because
 * concurrent inference thrashes a phone that is also holding a model.
 *
 * What the model consumes is whisper's transcription - what this phone
 * actually HEARD - unless CONSUME_TRANSCRIPTION is off (the rehearsed
 * fallback), in which case the sender's text is used and audio is decoration.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import {
  AUTO_ANSWER_MS,
  CONSUME_TRANSCRIPTION,
  CONVERSATION_MAX_TURNS,
  MIN_TURNS_BEFORE_AGREEMENT,
  RING_TIMEOUT_MS,
  isEcho,
  signalsAgreement,
} from './config';
import { transcribeWav, isWhisperReady } from './whisper';
import { turnAudioDir } from './whisperModel';
import type { Pairing } from './usePhoneInbox';
import type { CallInboxItem } from './usePhoneInbox';

export type CallPhase = 'idle' | 'dialing' | 'ringing' | 'active';
export type ActiveState = 'waiting' | 'listening' | 'thinking' | 'speaking';

export interface CallState {
  phase: CallPhase;
  /** Only meaningful while phase is 'active'. */
  activeState: ActiveState;
  sessionId: string | null;
  /** Who is on the other end, for the banner. */
  peerName: string | null;
  /** Seconds left on the auto-answer countdown while ringing, or null. */
  autoAnswerIn: number | null;
  turnNo: number;
}

const IDLE: CallState = {
  phase: 'idle',
  activeState: 'waiting',
  sessionId: null,
  peerName: null,
  autoAnswerIn: null,
  turnNo: 0,
};

export interface UseAudioCallOptions {
  relayUrl: string;
  pairing: Pairing | null;
  /** Model is loaded and the device can hold a conversation. */
  enabled: boolean;
  /** Ring-and-answer without a tap, for rehearsal. */
  autoAnswer: boolean;
  /** Produce this device's next line given the peer's (framed) words. */
  converseTurn: (text: string) => Promise<string>;
  /** Start the conversation model from a clean context. */
  resetConversation: () => void;
  /** Transcript / event sink. */
  onEvent: (line: string) => void;
}

export function useAudioCall(options: UseAudioCallOptions) {
  const { relayUrl, pairing, enabled, autoAnswer, converseTurn, resetConversation, onEvent } =
    options;
  const [call, setCall] = useState<CallState>(IDLE);

  const base = relayUrl.replace(/\/+$/, '');
  const laneRef = useRef<string | null>(null);
  laneRef.current = pairing?.agentId ?? null;

  // The live session, in a ref: inbox handlers arrive from outside React's
  // render cycle and must always see the current call, not a stale closure.
  const sessionRef = useRef<{
    id: string;
    role: 'caller' | 'callee';
    topic: string | null;
    myTurns: number;
    heardTurns: number;
    /** My previous line, for the self-repeat guard. */
    lastLine: string | null;
    /** Consecutive turns where I repeated myself despite a nudge. */
    stuck: number;
    ending: boolean;
  } | null>(null);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const converseRef = useRef(converseTurn);
  converseRef.current = converseTurn;
  const emit = (line: string) => onEventRef.current(line);

  const autoAnswerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (autoAnswerTimer.current) clearTimeout(autoAnswerTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    autoAnswerTimer.current = null;
    countdownTimer.current = null;
  };

  const toIdle = useCallback(() => {
    clearTimers();
    sessionRef.current = null;
    setCall(IDLE);
  }, []);

  /** POST a call endpoint; throws with the relay's error text on failure. */
  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `${path} returned ${res.status}`);
      return json;
    },
    [base],
  );

  /** Dial the peer. Resolves once the offer is placed, not when they answer. */
  const dial = useCallback(
    async (topic: string) => {
      const lane = laneRef.current;
      if (!lane || sessionRef.current) return;
      const body = await post('/call/offer', { from: lane });
      sessionRef.current = {
        id: String(body.sessionId),
        role: 'caller',
        topic,
        myTurns: 0,
        heardTurns: 0,
        lastLine: null,
        stuck: 0,
        ending: false,
      };
      setCall({ ...IDLE, phase: 'dialing', sessionId: String(body.sessionId) });
      emit(`📞 calling ${pairing?.peerName ?? 'the other phone'}…`);
      // If nobody answers, the relay hangs up for us; mirror it locally so the
      // UI cannot stick on "dialing" if that message is lost too.
      const sid = String(body.sessionId);
      setTimeout(() => {
        if (sessionRef.current?.id === sid && sessionRef.current.role === 'caller' && callRefPhase() === 'dialing') {
          emit('📴 no answer');
          toIdle();
        }
      }, RING_TIMEOUT_MS + 5_000);
    },
    [post, toIdle, pairing?.peerName],
  );

  // setCall is async; the dial timeout above needs the current phase.
  const phaseRef = useRef<CallPhase>('idle');
  useEffect(() => {
    phaseRef.current = call.phase;
  }, [call.phase]);
  const callRefPhase = () => phaseRef.current;

  /** Answer an incoming ring (tap or auto). */
  const answer = useCallback(async () => {
    const session = sessionRef.current;
    const lane = laneRef.current;
    if (!session || !lane || session.role !== 'callee') return;
    clearTimers();
    try {
      await post('/call/accept', { sessionId: session.id, from: lane });
      resetConversation();
      setCall((c) => ({ ...c, phase: 'active', activeState: 'waiting', autoAnswerIn: null }));
      emit('☎️  answered — waiting for them to speak');
    } catch (e) {
      emit(`⚠️  could not answer: ${(e as Error).message}`);
      toIdle();
    }
  }, [post, resetConversation, toIdle]);

  /** End the call from our side (button, agreement, or failure). */
  const hangUp = useCallback(
    async (reason: string) => {
      const session = sessionRef.current;
      const lane = laneRef.current;
      if (session && lane) {
        try {
          await post('/call/hangup', { sessionId: session.id, from: lane, reason });
        } catch {
          // The relay may already consider it over; local cleanup still runs.
        }
      }
      emit(`📴 hung up (${reason})`);
      toIdle();
    },
    [post, toIdle],
  );

  /** Speak one line into the call: TTS happens on the relay. */
  const sendTurn = useCallback(
    async (text: string) => {
      const session = sessionRef.current;
      const lane = laneRef.current;
      if (!session || !lane) return;
      setCall((c) => ({ ...c, activeState: 'speaking' }));
      await post('/call/turn', { sessionId: session.id, from: lane, text });
      session.myTurns += 1;
      setCall((c) => ({ ...c, activeState: 'waiting', turnNo: c.turnNo + 1 }));
    },
    [post],
  );

  /**
   * The caller's opening line, produced after the callee accepts. Framed as
   * an instruction because a small model given a bare topic just repeats it.
   */
  const speakOpening = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || !session.topic) return;
    setCall((c) => ({ ...c, phase: 'active', activeState: 'thinking' }));
    emit('☎️  they picked up');
    resetConversation();
    const line = sanitizeSpokenLine(
      await converseRef.current(
        `You are opening a phone call with another AI agent. The topic is: ` +
          `${session.topic}\nState your own opinion on it. Start with "I think" ` +
          `and give one concrete reason. One or two short sentences. Do not ` +
          `repeat the topic as a question and do not greet them.`,
      ),
    );
    session.lastLine = line;
    emit(`🗣 me: ${line}`);
    await sendTurn(line);
  }, [resetConversation, sendTurn]);

  /**
   * Fully process one received spoken turn. This is the heart of the demo:
   * play what they said out of the speaker while whisper listens to the same
   * bytes, then let the LLM answer what was HEARD.
   */
  const handleTurn = useCallback(
    async (item: CallInboxItem) => {
      const session = sessionRef.current;
      if (!session || item.sessionId !== session.id) return;
      setCall((c) => ({ ...c, phase: 'active', activeState: 'listening', turnNo: item.turnNo ?? c.turnNo }));

      const sent = item.debugText ?? '';
      let heard = sent;
      let heardVia = 'text';

      if (item.audioId) {
        try {
          const wavFile = new File(turnAudioDir(), `${item.audioId}.wav`);
          if (!wavFile.exists) {
            const task = File.createDownloadTask(`${base}/audio/${item.audioId}`, wavFile, {});
            const done = await task.downloadAsync();
            if (!done) throw new Error('audio download cancelled');
          }

          // Play and transcribe the same file at the same time. Playback is
          // for the room; whisper is what this agent actually goes on.
          const playbackDone = playToCompletion(wavFile.uri);
          if (CONSUME_TRANSCRIPTION) {
            const transcript = await transcribeWav(wavFile.uri);
            if (transcript) {
              heard = transcript;
              heardVia = 'whisper';
            } else {
              emit('👂 heard nothing intelligible; falling back to sent text');
            }
          }
          await playbackDone;
          wavFile.delete();
        } catch (e) {
          emit(`⚠️  audio failed (${(e as Error).message}); using sent text`);
        }
      }

      emit(`👂 heard: ${heard}${heardVia === 'whisper' ? `  (sent: ${sent})` : ''}`);

      // They think the matter is settled: close out politely and hang up.
      if (session.ending || (signalsAgreement(heard) && session.myTurns >= MIN_TURNS_BEFORE_AGREEMENT)) {
        await hangUp('agreed');
        return;
      }

      setCall((c) => ({ ...c, activeState: 'thinking' }));
      session.heardTurns += 1;
      // The first heard turn gets extra context: without it a small model
      // answers a phone call the way an assistant greets a customer, and the
      // two of them trade "I'm ready, let's begin" until the turn cap.
      const frame =
        session.heardTurns === 1 && session.role === 'callee'
          ? `On a phone call, the other agent just told you: ${heard}\n` +
            `State your own opinion about that. Start your reply with "I think" ` +
            `or "Honestly," and give one concrete reason. One or two short ` +
            `sentences. Do not repeat their words, do not introduce yourself, ` +
            `do not say you are ready or offer to help.`
          : `They just told you: ${heard}\n` +
            `React with your own view in one or two short sentences: agree or ` +
            `disagree and say why, or answer their question directly with a ` +
            `concrete pick. Do not repeat their words back.`;
      let reply = sanitizeSpokenLine(await converseRef.current(frame));
      if (isEcho(reply, heard) || (session.lastLine && isEcho(reply, session.lastLine))) {
        reply = sanitizeSpokenLine(
          await converseRef.current(
            `You are repeating yourself. Say something NEW - a different ` +
              `angle, a concrete example, or a question back. One or two ` +
              `sentences, and do not reuse your previous wording.`,
          ),
        );
      }
      // Still circling after the nudge means the model is stuck; a call that
      // loops the same sentence at the audience is worse than one that ends.
      if (session.lastLine && isEcho(reply, session.lastLine)) {
        session.stuck += 1;
        if (session.stuck >= 2) {
          emit('🔁 going in circles; hanging up');
          await hangUp('going-in-circles');
          return;
        }
      } else {
        session.stuck = 0;
      }
      session.lastLine = reply;

      emit(`🗣 me: ${reply}`);
      await sendTurn(reply);

      // Our own line may settle it; say it first, then hang up on our turn.
      if (signalsAgreement(reply) && session.myTurns >= MIN_TURNS_BEFORE_AGREEMENT) {
        session.ending = true;
        await hangUp('agreed');
        return;
      }
      if ((item.turnNo ?? 0) >= CONVERSATION_MAX_TURNS) {
        await hangUp('max-turns');
      }
    },
    [base, hangUp, sendTurn],
  );

  /** Entry point for typed items routed here by usePhoneInbox. */
  const onCallItem = useCallback(
    async (item: CallInboxItem) => {
      switch (item.kind) {
        case 'offer': {
          if (sessionRef.current) return; // already in a call; let it requeue and die with the session
          if (!enabled || !isWhisperReady()) {
            emit('📵 missed a call: models are not ready');
            return;
          }
          sessionRef.current = {
            id: item.sessionId,
            role: 'callee',
            topic: null,
            myTurns: 0,
            heardTurns: 0,
            lastLine: null,
            stuck: 0,
            ending: false,
          };
          setCall({
            ...IDLE,
            phase: 'ringing',
            sessionId: item.sessionId,
            peerName: item.fromName ?? 'other agent',
            autoAnswerIn: autoAnswer ? Math.ceil(AUTO_ANSWER_MS / 1000) : null,
          });
          emit(`🔔 ${item.fromName ?? 'the other phone'} is calling`);
          if (autoAnswer) {
            let left = Math.ceil(AUTO_ANSWER_MS / 1000);
            countdownTimer.current = setInterval(() => {
              left -= 1;
              setCall((c) => (c.phase === 'ringing' ? { ...c, autoAnswerIn: Math.max(left, 0) } : c));
            }, 1_000);
            autoAnswerTimer.current = setTimeout(() => {
              void answer();
            }, AUTO_ANSWER_MS);
          }
          break;
        }
        case 'accept': {
          const session = sessionRef.current;
          if (!session || item.sessionId !== session.id || session.role !== 'caller') return;
          await speakOpening();
          break;
        }
        case 'turn':
          await handleTurn(item);
          break;
        case 'hangup': {
          const session = sessionRef.current;
          if (session && item.sessionId !== session.id) return;
          if (session) {
            emit(`📴 they hung up (${item.reason ?? 'hangup'})`);
            toIdle();
          }
          break;
        }
      }
    },
    [enabled, autoAnswer, answer, speakOpening, handleTurn, toIdle],
  );

  // A relay restart reassigns lanes; any session it knew is gone with it.
  const lastLane = useRef<string | null>(null);
  useEffect(() => {
    const lane = pairing?.agentId ?? null;
    if (lastLane.current && lane !== lastLane.current && sessionRef.current) {
      emit('📴 call dropped: relay reassigned lanes');
      toIdle();
    }
    lastLane.current = lane;
  }, [pairing?.agentId, toIdle]);

  return { call, dial, answer, hangUp, onCallItem };
}

/**
 * What goes into TTS must read like speech. Gemma loves to wrap its whole
 * reply in quotation marks; spoken aloud those arrive as literal quotes in
 * the transcription and push the far model into echo mode.
 */
function sanitizeSpokenLine(text: string): string {
  let t = text.trim();
  const wrapped =
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('“') && t.endsWith('”')) ||
    (t.startsWith("'") && t.endsWith("'"));
  if (wrapped && t.length > 2) t = t.slice(1, -1).trim();
  return t.replace(/\s+/g, ' ').trim() || text.trim();
}

/** Play a WAV to the speaker; resolve when it finishes (or errors out). */
async function playToCompletion(uri: string): Promise<void> {
  await setAudioModeAsync({ playsInSilentMode: true });
  return new Promise((resolve) => {
    const player = createAudioPlayer({ uri });
    const finish = () => {
      try {
        player.remove();
      } catch {
        // already released
      }
      resolve();
    };
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) finish();
    });
    // A file that fails to load never emits didJustFinish; cap the wait at
    // the clip length when known, else a minute.
    setTimeout(finish, 60_000);
    player.play();
  });
}
