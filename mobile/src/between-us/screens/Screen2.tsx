import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { warmColors } from '../warmColors';
import { Wordmark } from '../components/Wordmark';
import { PhasePill } from '../components/PhasePill';
import type { AgentMove, PersonId } from '../types';

interface Props {
  personId: PersonId;
  onRoundComplete: (round: number) => void;
}

// Placeholder moves — replace with real agent exchange
const MOCK_MOVES: AgentMove[] = [
  {
    agentId: 'A',
    moveType: 'position',
    intent: 'opening position',
    payload: { text: 'The deadline needs to move by at least a week to be realistic.' },
    round: 1,
    timestamp: Date.now(),
  },
  {
    agentId: 'B',
    moveType: 'probe',
    intent: 'exploring flexibility',
    payload: { text: 'Exploring whether a partial delivery is acceptable.' },
    round: 1,
    timestamp: Date.now() + 2000,
  },
  {
    agentId: 'A',
    moveType: 'sharedClaim',
    intent: 'common ground',
    payload: { text: 'Both agents agree: the original scope is too broad for the time available.' },
    round: 1,
    timestamp: Date.now() + 4000,
  },
  {
    agentId: 'B',
    moveType: 'constraint',
    intent: 'hard limit',
    payload: { text: 'Has a constraint around stakeholder sign-off.' },
    round: 1,
    timestamp: Date.now() + 6000,
  },
];

function TypingDots() {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const anims = dots.map((dot, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 200),
          Animated.timing(dot, {
            toValue: 1,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(dot, {
            toValue: 0.3,
            duration: 400,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      )
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, []);

  return (
    <View style={typingStyles.row}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[typingStyles.dot, { opacity: d }]} />
      ))}
    </View>
  );
}

const typingStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: warmColors.textTertiary },
});

function Avatar({ isOwn }: { isOwn: boolean }) {
  const bg = isOwn ? warmColors.accentALight : warmColors.accentBLight;
  const color = isOwn ? warmColors.accentA : warmColors.accentB;
  const label = isOwn ? 'you' : 'them';
  return (
    <View style={[avatarStyles.circle, { backgroundColor: bg }]}>
      <Text style={[avatarStyles.letter, { color }]}>{label}</Text>
    </View>
  );
}

const avatarStyles = StyleSheet.create({
  circle: {
    width: 32,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  letter: { fontSize: 9, fontWeight: '500' },
});

function MoveBubble({
  move,
  personId,
  visible,
}: {
  move: AgentMove;
  personId: PersonId;
  visible: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  if (!visible) return null;

  const isOwn = move.agentId === personId;
  const isShared = move.moveType === 'sharedClaim';

  let bubbleStyle = bubbleStyles.otherBubble;
  let textContent: React.ReactNode = (
    <>
      <View style={bubbleStyles.redactedLine} />
      <View style={[bubbleStyles.redactedLine, { width: '70%' }]} />
      <Text style={bubbleStyles.intentLabel}>kept private — {move.intent}</Text>
    </>
  );

  if (isShared) {
    bubbleStyle = bubbleStyles.sharedBubble;
    textContent = (
      <>
        <Text style={bubbleStyles.agreedLabel}>agreed</Text>
        <Text style={bubbleStyles.sharedText}>{String(move.payload.text ?? '')}</Text>
      </>
    );
  } else if (isOwn) {
    bubbleStyle = bubbleStyles.ownBubble;
    textContent = (
      <Text style={bubbleStyles.ownText}>{String(move.payload.text ?? '')}</Text>
    );
  }

  return (
    <Animated.View style={[bubbleStyles.row, { opacity }]}>
      <Avatar isOwn={isOwn || isShared} />
      <View style={[bubbleStyles.bubble, bubbleStyle]}>{textContent}</View>
    </Animated.View>
  );
}

const bubbleStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bubble: { flex: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  ownBubble: { backgroundColor: warmColors.accentALight },
  sharedBubble: {
    backgroundColor: warmColors.sharedLight,
    borderWidth: 0.5,
    borderColor: warmColors.shared,
  },
  otherBubble: {
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
    borderStyle: 'dashed',
  },
  ownText: { fontSize: 13, color: warmColors.textPrimary, lineHeight: 13 * 1.6 },
  sharedText: { fontSize: 13, color: warmColors.textPrimary, lineHeight: 13 * 1.6 },
  agreedLabel: {
    fontSize: 9,
    color: warmColors.shared,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.36,
    marginBottom: 4,
  },
  redactedLine: {
    height: 6,
    borderRadius: 8,
    backgroundColor: warmColors.bgTertiary,
    marginBottom: 6,
    width: '90%',
  },
  intentLabel: {
    fontSize: 10,
    color: warmColors.textTertiary,
    fontStyle: 'italic',
    marginTop: 4,
  },
});

export function Screen2({ personId, onRoundComplete }: Props) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [round, setRound] = useState(1);
  const [roundComplete, setRoundComplete] = useState(false);

  const roundCardTranslate = useRef(new Animated.Value(40)).current;
  const roundCardOpacity = useRef(new Animated.Value(0)).current;
  const redactedOpacity = useRef(new Animated.Value(1)).current;

  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [visibleCount]);

  // Trickle in moves one at a time
  useEffect(() => {
    if (visibleCount >= MOCK_MOVES.length) {
      // Round complete sequence
      setTimeout(() => {
        // Fade out redacted blocks
        Animated.timing(redactedOpacity, {
          toValue: 0,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();

        setTimeout(() => {
          setRoundComplete(true);
          Animated.parallel([
            Animated.timing(roundCardOpacity, {
              toValue: 1,
              duration: 300,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(roundCardTranslate, {
              toValue: 0,
              duration: 300,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]).start(() => {
            setTimeout(() => onRoundComplete(round), 1500);
          });
        }, 500);
      }, 1200);
      return;
    }

    const delay = visibleCount === 0 ? 800 : 2000;
    const timer = setTimeout(() => setVisibleCount((c) => c + 1), delay);
    return () => clearTimeout(timer);
  }, [visibleCount]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.gap8} />
        <PhasePill label="your agents are talking" tone="taupe" />
        <View style={styles.gap8} />
        <Text style={styles.roundLabel}>round {round}</Text>
        <View style={styles.gap4} />
        <Text style={styles.subtitle}>
          They're working through this so you don't have to do it face to face.
        </Text>
        <View style={styles.gap10} />
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: warmColors.accentA }]} />
            <Text style={styles.legendText}>what your agent said</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: warmColors.shared }]} />
            <Text style={styles.legendText}>something you both agree on</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, styles.legendDotDashed]} />
            <Text style={styles.legendText}>their side, kept private</Text>
          </View>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.thread}
        showsVerticalScrollIndicator={false}
      >
        {MOCK_MOVES.map((move, i) => (
          <Animated.View
            key={i}
            style={
              move.moveType !== 'sharedClaim' && move.agentId !== personId
                ? { opacity: redactedOpacity }
                : undefined
            }
          >
            <MoveBubble move={move} personId={personId} visible={i < visibleCount} />
          </Animated.View>
        ))}

        {visibleCount > 0 && visibleCount < MOCK_MOVES.length && (
          <View style={styles.typingRow}>
            <Avatar isOwn={false} />
            <TypingDots />
          </View>
        )}

        <View style={styles.gap40} />
      </ScrollView>

      <Text style={styles.privacyNote}>
        what the other person told their agent stays with them
      </Text>

      {roundComplete && (
        <Animated.View
          style={[
            styles.roundCard,
            {
              opacity: roundCardOpacity,
              transform: [{ translateY: roundCardTranslate }],
            },
          ]}
        >
          <Text style={styles.roundCardTitle}>round {round} done</Text>
          <Text style={styles.roundCardBody}>
            Your agents found some common ground. Heading to your private debrief.
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: warmColors.border,
  },
  roundLabel: {
    fontSize: 13,
    fontFamily: 'Georgia',
    color: warmColors.textSecondary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: warmColors.textSecondary,
    textAlign: 'center',
    lineHeight: 13 * 1.6,
  },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendDotDashed: {
    width: 10,
    height: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: warmColors.textTertiary,
    borderStyle: 'dashed',
    borderRadius: 0,
  },
  legendText: { fontSize: 10, color: warmColors.textTertiary },
  thread: { paddingHorizontal: 20, paddingTop: 16, gap: 16 },
  typingRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  privacyNote: {
    fontSize: 10,
    color: warmColors.textTertiary,
    textAlign: 'center',
    paddingVertical: 10,
  },
  roundCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: warmColors.bgSecondary,
    borderTopWidth: 0.5,
    borderTopColor: warmColors.borderMedium,
    padding: 20,
    paddingBottom: 40,
  },
  roundCardTitle: {
    fontSize: 16,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    marginBottom: 6,
  },
  roundCardBody: {
    fontSize: 14,
    color: warmColors.textSecondary,
    lineHeight: 14 * 1.6,
  },
  gap4: { height: 4 },
  gap8: { height: 8 },
  gap10: { height: 10 },
  gap40: { height: 40 },
});
