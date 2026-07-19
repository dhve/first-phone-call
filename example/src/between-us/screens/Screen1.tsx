import React, { useState, useRef, useEffect } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { warmColors } from '../warmColors';
import { Wordmark } from '../components/Wordmark';
import { PhasePill } from '../components/PhasePill';
import { WarmButton } from '../components/WarmButton';
import type { IntakeAnswer } from '../types';

interface Props {
  onComplete: (answers: IntakeAnswer) => void;
}

interface Message {
  id: string;
  role: 'agent' | 'user';
  text: string;
}

const AGENT_QUESTIONS = [
  "What would feel like a good outcome for you?",
  "Is there anything you'd find really hard to agree to?",
  "How much wiggle room do you have here — or is this pretty fixed for you?",
  "Is there anything about your situation that would help your agent understand where you're coming from?",
];

const ANSWER_KEYS: (keyof IntakeAnswer)[] = [
  'goodOutcome',
  'hardLimit',
  'wiggleRoom',
  'personalContext',
];

function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={dotStyles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            dotStyles.dot,
            i < current ? dotStyles.active : dotStyles.inactive,
          ]}
        />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  dot: { height: 4, borderRadius: 2 },
  active: { width: 32, backgroundColor: warmColors.accentA },
  inactive: { width: 16, backgroundColor: warmColors.shared },
});

function MicButton({ active, onPress }: { active: boolean; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1.05,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 1.0,
            duration: 1000,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulse.stopAnimation();
      pulse.setValue(1);
    }
  }, [active]);

  return (
    <View style={micStyles.wrapper}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <TouchableOpacity
          style={[micStyles.circle, active && micStyles.circleActive]}
          onPress={onPress}
          activeOpacity={0.85}
        >
          <Text style={micStyles.icon}>🎙</Text>
        </TouchableOpacity>
      </Animated.View>
      <Text style={micStyles.label}>
        {active ? 'your agent is listening' : 'tap to speak'}
      </Text>
    </View>
  );
}

const micStyles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: 8 },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 1.5,
    borderColor: warmColors.shared,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleActive: {
    backgroundColor: warmColors.accentBLight,
    borderColor: warmColors.accentB,
  },
  icon: { fontSize: 24 },
  label: { fontSize: 12, color: warmColors.textSecondary },
});

export function Screen1({ onComplete }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'agent', text: AGENT_QUESTIONS[0] },
  ]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<IntakeAnswer>>({});
  const [input, setInput] = useState('');
  const [micActive, setMicActive] = useState(false);
  const [showTextInput, setShowTextInput] = useState(false);
  const [allDone, setAllDone] = useState(false);

  const readyOpacity = useRef(new Animated.Value(0)).current;
  const lastBubbleOpacity = useRef(new Animated.Value(1)).current;

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  useEffect(() => {
    if (allDone) {
      Animated.timing(readyOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [allDone]);

  const submitAnswer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMsg: Message = {
      id: `u${questionIndex}`,
      role: 'user',
      text: trimmed,
    };

    const newAnswers = { ...answers, [ANSWER_KEYS[questionIndex]]: trimmed };
    setAnswers(newAnswers);
    setInput('');

    const nextIndex = questionIndex + 1;

    if (nextIndex < AGENT_QUESTIONS.length) {
      const agentMsg: Message = {
        id: `a${nextIndex}`,
        role: 'agent',
        text: AGENT_QUESTIONS[nextIndex],
      };
      setMessages((prev) => [...prev, userMsg, agentMsg]);
      setQuestionIndex(nextIndex);
    } else {
      setMessages((prev) => [...prev, userMsg]);
      setAllDone(true);
    }
  };

  const handleReady = () => {
    // Last bubble fades, hold the "your agent has everything" message briefly, then router cross-fades
    Animated.timing(lastBubbleOpacity, {
      toValue: 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      setTimeout(() => {
        onComplete(answers as IntakeAnswer);
      }, 1200);
    });
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.gap8} />
        <PhasePill label="just between you and your agent" tone="caramel" />
        <View style={styles.gap12} />
        <ProgressDots total={AGENT_QUESTIONS.length} current={questionIndex + (allDone ? 1 : 0)} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1;
            const isUser = msg.role === 'user';
            return (
              <Animated.View
                key={msg.id}
                style={[
                  styles.bubbleWrapper,
                  isUser ? styles.userWrapper : styles.agentWrapper,
                  isLast && allDone ? { opacity: lastBubbleOpacity } : undefined,
                ]}
              >
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.agentBubble]}>
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.agentText]}>
                    {msg.text}
                  </Text>
                </View>
              </Animated.View>
            );
          })}

          {allDone && (
            <View style={styles.holdMessage}>
              <Text style={styles.holdText}>your agent has everything it needs</Text>
            </View>
          )}

          <View style={styles.gap40} />
        </ScrollView>

        {!allDone && (
          <View style={styles.inputArea}>
            {showTextInput ? (
              <View style={styles.textRow}>
                <TextInput
                  style={styles.textField}
                  value={input}
                  onChangeText={setInput}
                  placeholder="type your answer…"
                  placeholderTextColor={warmColors.textTertiary}
                  multiline
                  autoFocus
                />
                <TouchableOpacity
                  style={styles.sendBtn}
                  onPress={() => submitAnswer(input)}
                  disabled={!input.trim()}
                >
                  <Text style={styles.sendText}>→</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <MicButton
                active={micActive}
                onPress={() => {
                  // In real use, toggle STT. For now, treat as "done speaking"
                  if (micActive) {
                    submitAnswer('(voice answer placeholder)');
                  }
                  setMicActive(!micActive);
                }}
              />
            )}

            <TouchableOpacity
              style={styles.keyboardToggle}
              onPress={() => {
                setShowTextInput(!showTextInput);
                setMicActive(false);
              }}
            >
              <Text style={styles.keyboardIcon}>{showTextInput ? '🎙' : '⌨️'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {allDone && (
          <Animated.View style={[styles.readyBtn, { opacity: readyOpacity }]}>
            <WarmButton label="my agent is ready" onPress={handleReady} />
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },
  flex: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  thread: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  bubbleWrapper: { maxWidth: '82%' },
  agentWrapper: { alignSelf: 'flex-start' },
  userWrapper: { alignSelf: 'flex-end' },
  bubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  agentBubble: {
    backgroundColor: warmColors.accentALight,
  },
  userBubble: {
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 14 * 1.6,
  },
  agentText: { color: warmColors.textPrimary },
  userText: { color: warmColors.textPrimary },
  holdMessage: {
    alignSelf: 'center',
    marginTop: 24,
    paddingHorizontal: 20,
  },
  holdText: {
    fontSize: 16,
    fontFamily: 'Georgia',
    color: warmColors.textSecondary,
    textAlign: 'center',
    lineHeight: 16 * 1.6,
  },
  inputArea: {
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 16,
    alignItems: 'center',
    gap: 12,
    backgroundColor: warmColors.bgPrimary,
    borderTopWidth: 0.5,
    borderTopColor: warmColors.border,
  },
  textRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    width: '100%',
  },
  textField: {
    flex: 1,
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: warmColors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: warmColors.textPrimary,
    lineHeight: 14 * 1.6,
    minHeight: 44,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: warmColors.accentA,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { color: warmColors.bgPrimary, fontSize: 18 },
  keyboardToggle: {
    position: 'absolute',
    right: 20,
    bottom: 32,
  },
  keyboardIcon: { fontSize: 16 },
  readyBtn: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
  },
  gap8: { height: 8 },
  gap12: { height: 12 },
  gap40: { height: 40 },
});
