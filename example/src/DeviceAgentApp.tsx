import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { MODEL } from './config';
import { isModelDownloaded } from './modelManager';
import { discoverRelay } from './relayDiscovery';
import { loadRelayUrl, saveRelayUrl } from './relayStore';
import { useAgent, type UIMessage } from './useAgent';
import { callPeerAgent, usePhoneInbox } from './usePhoneInbox';

export function DeviceAgentApp() {
  const {
    status,
    progress,
    error,
    messages,
    initialize,
    send,
    answerRemote,
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

  const inbox = usePhoneInbox({
    relayUrl,
    enabled: idle,
    answer: answerRemote,
    onEvent: (line) => appendLine('tool', line),
  });

  const peerId = inbox.pairing?.peerId ?? null;
  const canCall = status === 'ready' && !calling && !!peerId;

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
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
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
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Ask the on-device agent…"
              placeholderTextColor="#9ca3af"
              multiline
            />
            <Pressable
              style={[styles.callBtn, !canCall && styles.sendBtnDisabled]}
              onPress={onCallPeer}
              disabled={!canCall}
            >
              {calling ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendText}>Call</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.sendBtn, status !== 'ready' && styles.sendBtnDisabled]}
              onPress={onSend}
              disabled={status !== 'ready'}
            >
              {status === 'thinking' ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.sendText}>Send</Text>
              )}
            </Pressable>
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
      <Text style={styles.hintText}>Send — ask this device's own model:</Text>
      <Text style={styles.hintItem}>• "What model are you running?"</Text>
      <Text style={styles.hintItem}>• "What time is it?"</Text>
      <Text style={styles.hintText}>Call — ask the agent on the other device:</Text>
      <Text style={styles.hintItem}>• "Who are you and what device are you on?"</Text>
      <Text style={styles.hintItem}>• "Introduce yourself in one sentence."</Text>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
  relayToggle: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
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
  callBtn: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  sendBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingHorizontal: 18, height: 44, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: '#93c5fd' },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  hint: { padding: 16, gap: 6 },
  hintText: { color: '#64748b', fontWeight: '600' },
  hintItem: { color: '#64748b', fontSize: 14, lineHeight: 20 },
});
