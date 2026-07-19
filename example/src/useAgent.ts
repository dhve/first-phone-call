import { useCallback, useRef, useState } from 'react';
import {
  Agent,
  LlamaEngine,
  ToolRegistry,
  defineTool,
  createBuiltinTools,
} from 'react-native-device-agent';
import {
  CONVERSATION_MAX_TURNS,
  CONVERSATION_SYSTEM_PROMPT,
  MODEL,
  REMOTE_MAX_TOKENS,
  REMOTE_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  isEcho,
  stripAgreementTic,
  stripThinking,
} from './config';
import { ensureModel } from './modelManager';

export type Status = 'idle' | 'downloading' | 'loading' | 'ready' | 'thinking' | 'error';

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

let _id = 0;
// Random prefix so ids stay unique across fast-refresh: a module reload resets
// the counter, and old messages still in state would collide with new ones —
// React then warns "two children with the same key" over the transcript.
const SESSION = Math.random().toString(36).slice(2, 7);
const nextId = () => `m${SESSION}-${++_id}`;

export function useAgent() {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const agentRef = useRef<Agent | null>(null);
  /**
   * Separate agent for messages arriving from other agents. It shares the
   * engine (the expensive part) but keeps its own history, so a remote call
   * never appears in — or contaminates — the local user's conversation.
   */
  const remoteAgentRef = useRef<Agent | null>(null);
  /** Agent that argues this device's side when driving a conversation. */
  const conversationAgentRef = useRef<Agent | null>(null);
  /**
   * Who we are currently talking to, and how many turns in. History is kept
   * across calls from the same caller — otherwise the far agent forgets the
   * argument between every message and cannot converge on anything — but is
   * dropped when a different caller appears, so one conversation never leaks
   * into another's context.
   */
  const remoteCallerRef = useRef<string | null>(null);
  const remoteTurnsRef = useRef(0);

  /**
   * Serializes everything that touches the model.
   *
   * There is one llama context, and three things want it: the local chat, an
   * incoming call, and our own side of a conversation. They must not overlap.
   * The obvious alternative — refusing to listen while busy — deadlocks the
   * moment both phones start a conversation at once: each waits for a reply
   * the other has stopped being able to give. Queueing lets both proceed, just
   * one at a time.
   */
  const lockRef = useRef<Promise<unknown>>(Promise.resolve());
  const withEngine = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = lockRef.current.then(fn, fn);
    // Keep the chain alive even if this turn rejected.
    lockRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const append = useCallback((role: UIMessage['role'], text: string) => {
    const id = nextId();
    setMessages((prev) => [...prev, { id, role, text }]);
    return id;
  }, []);

  const updateText = useCallback((id: string, text: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text } : m)));
  }, []);

  /** Download the model (if needed), load it, and build the agent. */
  const initialize = useCallback(async () => {
    try {
      setError(null);
      setStatus('downloading');
      const uri = await ensureModel((f) => setProgress(f));

      setStatus('loading');
      const engine = await LlamaEngine.load({ model: uri, n_ctx: MODEL.nCtx });

      // Built-in tools + one custom tool to show the registration API.
      const registry = new ToolRegistry([
        ...createBuiltinTools({
          network: {},
          filesystem: {},
          clipboard: true,
          notifications: true,
          contacts: true,
          calendar: true,
          location: true,
        }),
        defineTool({
          name: 'get_current_time',
          description: 'Get the current date and time on the device.',
          parameters: { type: 'object', properties: {} },
          execute: () => ({ iso: new Date().toISOString() }),
        }),
      ]);

      agentRef.current = new Agent({
        engine,
        registry,
        systemPrompt: SYSTEM_PROMPT,
      });
      // No tool registry on the agent-to-agent paths, deliberately. Tools
      // pull a 0.6B model into tech-assistant mode: asked "broccoli or
      // carrot?" it answered about accessibility and performance, told
      // "First call on Internet" it tried to resolve a hostname. A
      // conversation partner just talks; only the local chat gets tools.
      // enableThinking: false — Qwen3.5 thinks by default and spends the
      // whole token budget inside <think>, which surfaced as every reply
      // arriving as "(no reply)". Conversation turns need answers, not
      // deliberation.
      remoteAgentRef.current = new Agent({
        engine,
        systemPrompt: REMOTE_SYSTEM_PROMPT,
        maxTokens: REMOTE_MAX_TOKENS,
        enableThinking: false,
      });
      conversationAgentRef.current = new Agent({
        engine,
        systemPrompt: CONVERSATION_SYSTEM_PROMPT,
        maxTokens: REMOTE_MAX_TOKENS,
        enableThinking: false,
      });
      setStatus('ready');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }, []);

  /** Send a user turn and stream the agent's response + tool activity. */
  const send = useCallback(
    async (text: string) => {
      const agent = agentRef.current;
      if (!agent || status === 'thinking') return;

      append('user', text);
      setStatus('thinking');

      let streamId: string | null = null;
      let streamed = '';

      try {
        await agent.send(text, {
          onEvent: (e) => {
            switch (e.type) {
              case 'step':
                streamId = null;
                streamed = '';
                break;
              case 'token':
                if (!streamId) streamId = append('assistant', '');
                streamed += e.text;
                updateText(streamId, streamed);
                break;
              case 'assistant_message':
                // If the step only produced tool calls, drop the empty bubble.
                if (e.toolCalls?.length && streamId && !streamed.trim()) {
                  const id = streamId;
                  setMessages((prev) => prev.filter((m) => m.id !== id));
                  streamId = null;
                }
                break;
              case 'tool_call': {
                const args = e.call.function.arguments || '{}';
                append('tool', `🛠️  ${e.call.function.name}(${args})`);
                break;
              }
              case 'tool_result': {
                const body = e.error
                  ? `⚠️  ${e.error}`
                  : `↳ ${JSON.stringify(e.result)}`;
                append('tool', body);
                break;
              }
              case 'final':
                if (!streamId) append('assistant', e.content);
                else updateText(streamId, e.content);
                break;
            }
          },
        });
      } catch (e) {
        append('tool', `⚠️  ${(e as Error).message}`);
      } finally {
        setStatus('ready');
      }
    },
    [status, append, updateText],
  );

  /**
   * Answer a message that arrived from another agent via the relay.
   *
   * History is kept for as long as the same caller string keeps calling, so a
   * back-and-forth actually builds on itself — without that, the far side
   * restates its opening position forever and never converges. The caller
   * string carries a per-conversation suffix ("agent-a#t3"), so every new
   * conversation or one-off call starts from a clean context; it also resets
   * after enough turns that the 4k window would otherwise be at risk.
   */
  const answerRemote = useCallback(async (text: string, from: string): Promise<string> => {
    const agent = remoteAgentRef.current;
    if (!agent) throw new Error('model not loaded yet');

    const newCaller = remoteCallerRef.current !== from;
    const tooLong = remoteTurnsRef.current >= CONVERSATION_MAX_TURNS * 2;
    if (newCaller || tooLong) {
      agent.reset();
      remoteCallerRef.current = from;
      remoteTurnsRef.current = 0;
    }
    remoteTurnsRef.current += 1;

    // The instruction rides in the message, not just the system prompt. A
    // 0.6B model mostly ignores its system prompt but follows the turn in
    // front of it — the driving side of a conversation got coherent the
    // moment its turns were framed this way, while this side kept answering
    // "do you prefer broccoli or carrots?" with assistant boilerplate about
    // scheduling, because the bare text carried no instruction at all.
    const framed =
      `The other agent says: "${text}". Reply as yourself in one or two ` +
      `casual sentences. Answer what they actually asked; if they ask you ` +
      `to choose between things, pick one and give a quick reason — never ` +
      `refuse, never offer help with tasks.`;

    let reply = stripThinking(await withEngine(() => agent.send(framed)));

    // A stray <think> block can burn the whole token budget and strip to
    // nothing. One retry with thinking forced off for the turn.
    if (!reply) {
      reply = stripThinking(await withEngine(() => agent.send(framed)));
    }

    // Parroting the prompt back is the failure mode of a small model in a long
    // exchange, and it feeds itself: the echo lands in history and makes the
    // next echo likelier. Drop that history and ask once more, plainly.
    if (isEcho(reply, text)) {
      agent.reset();
      remoteCallerRef.current = from;
      remoteTurnsRef.current = 1;
      reply = stripThinking(
        await withEngine(() =>
          agent.send(
            `Answer this in your own words, in one or two sentences. Do not ` +
              `repeat it back. Message: ${text}`,
          ),
        ),
      );
      if (isEcho(reply, text)) {
        return 'Sorry — I could not add anything useful to that.';
      }
    }

    return stripAgreementTic(reply) || '(no reply)';
  }, [withEngine]);

  /**
   * Produce this device's next line in a conversation with another agent.
   * Unlike `send`, nothing is written to the transcript here — the caller
   * decides how to display a turn it is also relaying over the network.
   */
  const converseTurn = useCallback(
    async (text: string): Promise<string> => {
      const agent = conversationAgentRef.current;
      if (!agent) throw new Error('model not loaded yet');
      let reply = stripThinking(await withEngine(() => agent.send(text)));
      if (!reply) {
        // Thinking ate the budget; one retry with it off for this turn.
        reply = stripThinking(await withEngine(() => agent.send(text)));
      }
      return stripAgreementTic(reply) || '(no reply)';
    },
    [withEngine],
  );

  /** Begin a fresh conversation, discarding any previous one. */
  const resetConversation = useCallback(() => {
    conversationAgentRef.current?.reset();
  }, []);

  /** Append a line to the transcript from outside the chat flow. */
  const appendLine = useCallback(
    (role: UIMessage['role'], text: string) => append(role, text),
    [append],
  );

  /** True once the model is loaded and not mid-generation. */
  const idle = status === 'ready';

  return {
    status,
    progress,
    error,
    messages,
    initialize,
    send,
    answerRemote,
    converseTurn,
    resetConversation,
    appendLine,
    idle,
  };
}
