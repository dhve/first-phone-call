import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  CONVERSATION_MAX_TURNS,
  MIN_TURNS_BEFORE_AGREEMENT,
  MODEL,
  signalsAgreement,
} from './config';
import { isModelDownloaded } from './modelManager';
import { discoverRelay } from './relayDiscovery';
import { loadRelayUrl, saveRelayUrl } from './relayStore';
import { useAgent, type UIMessage } from './useAgent';
import { callPeerAgent, usePhoneInbox } from './usePhoneInbox';

type Mode = 'local' | 'peer' | 'auto';

/**
 * The three things this app can do, named by who answers rather than by what
 * the code calls them — "Send"/"Call"/"Talk" gave no clue which one reached
 * the other device.
 */
const MODES: {
  key: Mode;
  label: string;
  action: string;
  hint: string;
  placeholder: string;
  needsPeer: boolean;
  tint: object;
}[] = [
  {
    key: 'local',
    label: 'This phone',
    action: 'Ask',
    hint: 'answered by the model on this device',
    placeholder: 'Ask this phone…',
    needsPeer: false,
    tint: { backgroundColor: '#2563eb' },
  },
  {
    key: 'peer',
    label: 'Other phone',
    action: 'Call',
    hint: 'sent to the other agent, which answers on its own device',
    placeholder: 'Ask the other phone…',
    needsPeer: true,
    tint: { backgroundColor: '#16a34a' },
  },
  {
    key: 'auto',
    label: 'Let them talk',
    action: 'Start',
    hint: 'both agents discuss it until they agree, or 8 turns',
    placeholder: 'Give them something to settle…',
    needsPeer: true,
    tint: { backgroundColor: '#7c3aed' },
  },
];

export function DeviceAgentApp() {
  const {
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
  } = useAgent();
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<UIMessage>>(null);

  // Only the relay address is configured; lanes and peer are auto-assigned.
  // It stays editable because LAN addresses move with the network, and is
  // persisted so a correction survives the next reload.
  //
  // The draft is separate from the committed value on purpose: usePhoneInbox
  // restarts its pairing loop whenever relayUrl changes, so binding the input
  // straight to it would tear down and re-register on every keystroke.
  const [relayUrl, setRelayUrl] = useState(loadRelayUrl);
  const [relayDraft, setRelayDraft] = useState(relayUrl);
  const [showRelay, setShowRelay] = useState(false);

  const commitRelayUrl = () => {
    const next = relayDraft.trim();
    if (!next || next === relayUrl) return;
    saveRelayUrl(next);
    setRelayUrl(next);
    appendLine('tool', `🔗 relay set to ${next}`);
  };
  const [calling, setCalling] = useState(false);
  const [conversing, setConversing] = useState(false);
  /** Lets the Stop button break the loop between turns. */
  const stopRef = useRef(false);

  const inbox = usePhoneInbox({
    relayUrl,
    // Keep listening even while driving a conversation. Going deaf here
    // deadlocks two phones that start one at the same time — each waits on a
    // reply the other can no longer give. useAgent serializes the model, so
    // an incoming call queues behind our own turn instead of racing it.
    enabled: idle,
    answer: answerRemote,
    onEvent: (line) => appendLine('tool', line),
  });

  const peerId = inbox.pairing?.peerId ?? null;
  const [mode, setMode] = useState<Mode>('local');
  const current = MODES.find((m) => m.key === mode) ?? MODES[0];
  const needsPeer = current.needsPeer;
  const busy = calling || conversing || status === 'thinking';
  const canAct = status === 'ready' && !busy && (!needsPeer || !!peerId);

  const onPrimary = () => {
    if (mode === 'local') return onSend();
    if (mode === 'peer') return void onCallPeer();
    return void onTalk();
  };

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Auto-load when the model is already on disk, so a device comes back up
  // listening after a restart instead of waiting for someone to tap a button.
  // The first run still shows the gate, since a ~370 MB download on someone
  // else's data plan should be a deliberate choice.
  useEffect(() => {
    if (status === 'idle' && isModelDownloaded()) initialize();
  }, [status, initialize]);

  const ready = status === 'ready' || status === 'thinking';

  // Find the relay before trusting the saved address. The dev machine's IP
  // moves between networks, and a stale address is the failure that looks
  // like "the whole demo is broken" when it is one wrong octet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const found = await discoverRelay();
      if (cancelled) return;

      if (!found.reachable) {
        appendLine('tool', `⚠️  no relay answered at: ${found.tried.join(', ')}`);
        return;
      }
      if (found.url !== relayUrl) {
        saveRelayUrl(found.url);
        setRelayUrl(found.url);
        setRelayDraft(found.url);
        appendLine('tool', `🔗 found relay at ${found.url}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount: later changes come from discovery or a manual edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Place an outbound call to the paired agent and show its reply. */
  const onCallPeer = async () => {
    const text = input.trim();
    if (!text || calling || !peerId || !inbox.pairing) return;
    setInput('');
    setCalling(true);
    appendLine('user', `📱 → ${inbox.pairing.peerName ?? 'other agent'}: ${text}`);
    const res = await callPeerAgent({
      relayUrl,
      peerId,
      message: text,
      from: `agent-${inbox.pairing.agentId}`,
    });
    if (res.ok) {
      appendLine('assistant', `📞 other agent: ${res.reply}`);
    } else {
      appendLine('tool', `⚠️  call failed: ${res.error}`);
    }
    setCalling(false);
  };

  /**
   * Hand a question to the two agents and let them talk until they settle it.
   *
   * Each round is: our agent speaks, the peer answers over the relay, and its
   * answer becomes the prompt for our next line. It ends when either side
   * signals agreement, when the turn cap is hit, or when the user stops it.
   * The cap is not a formality — a 0.6B model follows the agreement
   * instruction unreliably, so most runs end by running out of turns.
   */
  const onTalk = async () => {
    const topic = input.trim();
    if (!topic || conversing || !peerId || !inbox.pairing) return;
    setInput('');
    setConversing(true);
    stopRef.current = false;
    resetConversation();

    const me = `agent-${inbox.pairing.agentId}`;
    const peerName = inbox.pairing.peerName ?? 'other agent';
    appendLine('tool', `🎙️  topic: ${topic}`);

    try {
      let line = await converseTurn(
        `Another agent is on the line. Open the conversation about this, in one or two sentences: ${topic}`,
      );

      for (let turn = 1; turn <= CONVERSATION_MAX_TURNS; turn++) {
        if (stopRef.current) {
          appendLine('tool', '⏹️  stopped');
          return;
        }

        appendLine('user', `📱 me → ${peerName}: ${line}`);
        const res = await callPeerAgent({ relayUrl, peerId, message: line, from: me });
        if (!res.ok) {
          appendLine('tool', `⚠️  call failed: ${res.error}`);
          return;
        }
        appendLine('assistant', `📞 ${peerName}: ${res.reply}`);

        if (turn >= MIN_TURNS_BEFORE_AGREEMENT && signalsAgreement(res.reply)) {
          appendLine('tool', `🤝 agreed after ${turn} turn${turn === 1 ? '' : 's'}`);
          return;
        }
        if (turn === CONVERSATION_MAX_TURNS) {
          appendLine('tool', `⏱️  stopped at the ${CONVERSATION_MAX_TURNS}-turn limit`);
          return;
        }
        if (stopRef.current) {
          appendLine('tool', '⏹️  stopped');
          return;
        }

        line = await converseTurn(res.reply);
        if (turn >= MIN_TURNS_BEFORE_AGREEMENT && signalsAgreement(line)) {
          appendLine('user', `📱 me → ${peerName}: ${line}`);
          await callPeerAgent({ relayUrl, peerId, message: line, from: me });
          appendLine('tool', `🤝 agreed after ${turn} turn${turn === 1 ? '' : 's'}`);
          return;
        }
      }
    } catch (e) {
      appendLine('tool', `⚠️  conversation failed: ${(e as Error).message}`);
    } finally {
      setConversing(false);
    }
  };

  const onSend = () => {
    const text = input.trim();
    if (!text || status !== 'ready') return;
    setInput('');
    send(text);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Device Agent</Text>
          {ready && (
            <Pressable onPress={() => setShowRelay((v) => !v)} hitSlop={10}>
              <Text style={styles.relayToggle}>{showRelay ? 'hide' : 'relay'}</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.subtitle}>
          {statusLabel(status)}
          {ready ? ` · ${inboxLabel(inbox.status, inbox.answered)}` : ''}
        </Text>
      </View>

      {ready && showRelay && (
        <View style={styles.relayPanel}>
          <Text style={styles.relayLabel}>Relay address</Text>
          <TextInput
            style={styles.relayInput}
            value={relayDraft}
            onChangeText={setRelayDraft}
            onBlur={commitRelayUrl}
            onSubmitEditing={commitRelayUrl}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.relayLabel}>
            {inbox.pairing
              ? `I am agent "${inbox.pairing.agentId}"` +
                (inbox.pairing.peerId
                  ? ` · paired with "${inbox.pairing.peerId}"`
                  : ' · waiting for the other device…')
              : 'registering…'}
          </Text>
          {inbox.lastError && (
            <Text style={styles.relayError}>relay error: {inbox.lastError}</Text>
          )}
        </View>
      )}

      {!ready ? (
        <Gate status={status} progress={progress} error={error} onStart={initialize} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          // Android needs a behavior too. Left undefined it does nothing, and
          // adjustResize in the manifest is ignored under edge-to-edge, so the
          // keyboard slid straight over the composer.
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <Bubble message={item} />}
            ListEmptyComponent={<Hint />}
          />
          <View style={styles.composer}>
            {/* Who answers is a choice, not three competing buttons. Picking it
                up front leaves one obvious action and a full-width input. */}
            <View style={styles.modeRow}>
              {MODES.map((m) => {
                const active = mode === m.key;
                const blocked = m.needsPeer && !peerId;
                return (
                  <Pressable
                    key={m.key}
                    style={[
                      styles.modePill,
                      active && styles.modePillActive,
                      blocked && styles.modePillBlocked,
                    ]}
                    onPress={() => setMode(m.key)}
                    disabled={busy}
                  >
                    <Text style={[styles.modeText, active && styles.modeTextActive]}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modeHint}>
              {needsPeer && !peerId
                ? 'waiting for the other phone to join…'
                : current.hint}
            </Text>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder={current.placeholder}
                placeholderTextColor="#9ca3af"
                multiline
                editable={!busy}
              />
              {conversing ? (
                <Pressable style={styles.stopBtn} onPress={() => (stopRef.current = true)}>
                  <Text style={styles.actionText}>Stop</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.actionBtn, current.tint, !canAct && styles.actionDisabled]}
                  onPress={onPrimary}
                  disabled={!canAct}
                >
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.actionText}>{current.action}</Text>
                  )}
                </Pressable>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Gate(props: {
  status: string;
  progress: number;
  error: string | null;
  onStart: () => void;
}) {
  const { status, progress, error, onStart } = props;
  return (
    <View style={styles.gate}>
      {status === 'idle' && (
        <>
          <Text style={styles.gateText}>
            This demo runs a {MODEL.sizeLabel} LLM fully on your device. The model
            downloads once, then works offline.
          </Text>
          <Pressable style={styles.primaryBtn} onPress={onStart}>
            <Text style={styles.primaryText}>Download &amp; load model</Text>
          </Pressable>
        </>
      )}
      {status === 'downloading' && (
        <>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.gateText}>Downloading model… {Math.round(progress * 100)}%</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </>
      )}
      {status === 'loading' && (
        <>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.gateText}>Loading model into memory…</Text>
        </>
      )}
      {status === 'error' && (
        <>
          <Text style={[styles.gateText, styles.errorText]}>Error: {error}</Text>
          <Pressable style={styles.primaryBtn} onPress={onStart}>
            <Text style={styles.primaryText}>Retry</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function Bubble({ message }: { message: UIMessage }) {
  if (message.role === 'tool') {
    return (
      <View style={styles.toolBubble}>
        <Text style={styles.toolText}>{message.text}</Text>
      </View>
    );
  }
  const isUser = message.role === 'user';
  return (
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      <Text style={isUser ? styles.userText : styles.assistantText}>
        {message.text || '…'}
      </Text>
    </View>
  );
}

function Hint() {
  return (
    <View style={styles.hint}>
      <Text style={styles.hintText}>This phone — answered here, on-device:</Text>
      <Text style={styles.hintItem}>• "What time is it?"</Text>
      <Text style={styles.hintText}>Other phone — answered on the other device:</Text>
      <Text style={styles.hintItem}>• "Introduce yourself in one sentence."</Text>
      <Text style={styles.hintText}>Let them talk — both agents, until they agree:</Text>
      <Text style={styles.hintItem}>• "Should agents run on-device or in the cloud?"</Text>
      <Text style={styles.hintItem}>• "Agree on one rule for AI agents."</Text>
    </View>
  );
}

function inboxLabel(status: string, answered: number): string {
  const n = answered > 0 ? ` (${answered})` : '';
  switch (status) {
    case 'pairing': return 'waiting for the other device…';
    case 'listening': return `listening${n}`;
    case 'answering': return 'answering a call…';
    case 'error': return 'relay unreachable';
    default: return 'offline';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle': return 'Model not loaded';
    case 'downloading': return 'Downloading…';
    case 'loading': return 'Loading…';
    case 'ready': return 'Ready · on-device';
    case 'thinking': return 'Thinking…';
    case 'error': return 'Error';
    default: return status;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    // SafeAreaView does not inset the Android status bar, so the title was
    // drawing over the clock.
    paddingTop: (Platform.OS === 'android' ? RNStatusBar.currentHeight ?? 24 : 0) + 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  relayToggle: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  composer: {
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
    paddingTop: 8,
  },
  modeRow: { flexDirection: 'row', paddingHorizontal: 12, gap: 6 },
  modePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  modePillActive: { backgroundColor: '#0f172a' },
  modePillBlocked: { opacity: 0.45 },
  modeText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  modeTextActive: { color: '#fff' },
  modeHint: {
    fontSize: 11,
    color: '#94a3b8',
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  actionBtn: {
    borderRadius: 10,
    paddingHorizontal: 18,
    minWidth: 72,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  actionDisabled: { backgroundColor: '#cbd5e1' },
  stopBtn: {
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  relayPanel: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  relayLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  relayInput: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  relayError: { fontSize: 12, color: '#dc2626' },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  gateText: { fontSize: 16, color: '#334155', textAlign: 'center', lineHeight: 22 },
  errorText: { color: '#dc2626' },
  primaryBtn: { backgroundColor: '#2563eb', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 12 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  progressTrack: { width: '80%', height: 8, backgroundColor: '#e2e8f0', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: 8, backgroundColor: '#2563eb' },
  listContent: { padding: 16, gap: 8 },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  userBubble: { alignSelf: 'flex-end', backgroundColor: '#2563eb', borderBottomRightRadius: 4 },
  assistantBubble: { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0' },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  assistantText: { color: '#0f172a', fontSize: 15, lineHeight: 21 },
  toolBubble: { alignSelf: 'center', backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '92%' },
  toolText: { color: '#475569', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e8f0', backgroundColor: '#fff' },
  input: { flex: 1, maxHeight: 120, minHeight: 44, backgroundColor: '#f1f5f9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#0f172a' },
  hint: { padding: 16, gap: 6 },
  hintText: { color: '#64748b', fontWeight: '600' },
  hintItem: { color: '#64748b', fontSize: 14, lineHeight: 20 },
});
