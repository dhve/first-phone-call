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
import { useAgent, type UIMessage } from './useAgent';

export function DeviceAgentApp() {
  const { status, progress, error, messages, initialize, send } = useAgent();
  const [input, setInput] = useState('');
  const listRef = useRef<FlatList<UIMessage>>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const ready = status === 'ready' || status === 'thinking';

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
        <Text style={styles.title}>Device Agent</Text>
        <Text style={styles.subtitle}>{statusLabel(status)}</Text>
      </View>

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
      <Text style={styles.hintText}>Try:</Text>
      <Text style={styles.hintItem}>• "Copy 'hello world' to my clipboard, then read it back."</Text>
      <Text style={styles.hintItem}>• "What time is it, and remind me in 30 seconds to stretch."</Text>
      <Text style={styles.hintItem}>• "Save a note called todo.txt with three ideas, then list my files."</Text>
    </View>
  );
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
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 2 },
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
