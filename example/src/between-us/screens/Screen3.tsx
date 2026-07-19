import React, { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { warmColors } from '../warmColors';
import { Wordmark } from '../components/Wordmark';
import { PhasePill } from '../components/PhasePill';
import { DisplayTitle } from '../components/DisplayTitle';
import { WarmButton } from '../components/WarmButton';
import type { DebriefInsight } from '../types';

interface Props {
  insight: DebriefInsight;
  otherPersonReady: boolean;
  onNextRound: (followUp?: string) => void;
}

// Placeholder insight — replace with real agent output
export const MOCK_INSIGHT: DebriefInsight = {
  whatTheyCareAbout:
    'They seem to care a lot about having enough runway — not just the deadline itself, but the feeling of not being rushed into something half-finished.',
  whereThereIsAGap:
    "You're both willing to adjust scope, but you haven't agreed yet on what gets cut. That's the gap your agents are circling.",
  whatAgentNeedsFromYou:
    "Is there one thing on the list that you'd be okay removing entirely, if it meant keeping the rest on track?",
};

function InsightCard({
  label,
  body,
  delay,
}: {
  label: string;
  body: string;
  delay: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(10)).current;

  React.useEffect(() => {
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Animated.View
      style={[
        cardStyles.card,
        { opacity, transform: [{ translateY: translate }] },
      ]}
    >
      <Text style={cardStyles.label}>{label}</Text>
      <View style={{ height: 8 }} />
      <Text style={cardStyles.body}>{body}</Text>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  label: {
    fontSize: 10,
    fontWeight: '500',
    color: warmColors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  body: {
    fontSize: 14,
    color: warmColors.textPrimary,
    lineHeight: 14 * 1.6,
  },
});

function WaitingPulse() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <Animated.Text style={[waitStyles.text, { opacity }]}>
      your agent is waiting for theirs…
    </Animated.Text>
  );
}

const waitStyles = StyleSheet.create({
  text: {
    fontSize: 13,
    color: warmColors.textTertiary,
    textAlign: 'center',
    lineHeight: 13 * 1.6,
  },
});

export function Screen3({ insight, otherPersonReady, onNextRound }: Props) {
  const [followUp, setFollowUp] = useState('');
  const hasFollowUp = insight.whatAgentNeedsFromYou !== null;

  const buttonLabel =
    followUp.trim()
      ? 'share this with my agent'
      : "I'm ready for the next round";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
    >
      <Wordmark />
      <View style={styles.gap8} />
      <PhasePill label="what your agent found out" tone="caramel" />

      <View style={styles.gap20} />
      <DisplayTitle>Here's what's going on</DisplayTitle>
      <View style={styles.gap8} />
      <Text style={styles.subtitle}>
        Your agent's read on the other side — not their words, just what seems true.
      </Text>

      <View style={styles.gap24} />

      <InsightCard
        label="what they seem to care about"
        body={insight.whatTheyCareAbout}
        delay={200}
      />
      <View style={styles.gap12} />
      <InsightCard
        label="where there's a gap"
        body={insight.whereThereIsAGap}
        delay={450}
      />

      {hasFollowUp && (
        <>
          <View style={styles.gap12} />
          <InsightCard
            label="one more thing"
            body={insight.whatAgentNeedsFromYou!}
            delay={700}
          />
          <View style={styles.gap12} />
          <TextInput
            style={styles.followUpInput}
            value={followUp}
            onChangeText={setFollowUp}
            placeholder="your answer…"
            placeholderTextColor={warmColors.textTertiary}
            multiline
            textAlignVertical="top"
          />
        </>
      )}

      <View style={styles.gap28} />

      {!otherPersonReady && (
        <>
          <WaitingPulse />
          <View style={styles.gap16} />
        </>
      )}

      <WarmButton
        label={buttonLabel}
        disabled={!otherPersonReady}
        onPress={() => onNextRound(followUp.trim() || undefined)}
      />

      <View style={styles.gap40} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },
  scroll: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: warmColors.textSecondary,
    lineHeight: 14 * 1.6,
  },
  followUpInput: {
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: warmColors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: warmColors.textPrimary,
    lineHeight: 14 * 1.6,
    minHeight: 80,
  },
  gap8: { height: 8 },
  gap12: { height: 12 },
  gap16: { height: 16 },
  gap20: { height: 20 },
  gap24: { height: 24 },
  gap28: { height: 28 },
  gap40: { height: 40 },
});
