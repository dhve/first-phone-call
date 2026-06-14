import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { warmColors } from '../warmColors';
import { Wordmark } from '../components/Wordmark';
import { PhasePill } from '../components/PhasePill';
import { DisplayTitle } from '../components/DisplayTitle';
import { WarmButton } from '../components/WarmButton';
import type { PersonId, VerdictResult } from '../types';

interface Props {
  verdict: VerdictResult;
  personId: PersonId;
  otherPersonAccepted: boolean;
  onAccept: () => void;
  onDispute: () => void;
}

// Placeholder verdict — replace with real agent synthesis
export const MOCK_VERDICT: VerdictResult = {
  sharedAgreement:
    "You'll reduce the scope by removing the reporting module from this sprint. The deadline stays, but the deliverable is smaller and better defined.",
  whatItMeansForYou:
    "You have clear ownership of the core feature, with the pressure of the extra work removed. You'll have what you need to deliver something you're proud of.",
  whatTheyGet:
    'They get a committed, focused delivery on the core feature — which is what matters most to their stakeholders right now.',
};

function VerdictCard({
  label,
  body,
  tint,
  delay,
}: {
  label: string;
  body: string;
  tint: string;
  delay: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);

  return (
    <Animated.View
      style={[
        cardStyles.card,
        { backgroundColor: tint, opacity, transform: [{ translateY: translate }] },
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

  useEffect(() => {
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
      waiting for them to say it works too…
    </Animated.Text>
  );
}

const waitStyles = StyleSheet.create({
  text: { fontSize: 13, color: warmColors.textTertiary, textAlign: 'center' },
});

export function Screen4({
  verdict,
  personId,
  otherPersonAccepted,
  onAccept,
  onDispute,
}: Props) {
  const [accepted, setAccepted] = React.useState(false);
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const resolvedOpacity = useRef(new Animated.Value(0)).current;

  const myTint = personId === 'A' ? warmColors.accentALight : warmColors.accentBLight;

  useEffect(() => {
    if (accepted && otherPersonAccepted) {
      // Full-screen warm flash then "you worked it out"
      Animated.sequence([
        Animated.timing(flashOpacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(flashOpacity, {
          toValue: 0,
          duration: 200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.timing(resolvedOpacity, {
          toValue: 1,
          duration: 400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    }
  }, [accepted, otherPersonAccepted]);

  const handleAccept = () => {
    setAccepted(true);
    onAccept();
  };

  return (
    <View style={styles.screen}>
      {/* Flash overlay */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.flash, { opacity: flashOpacity }]}
        pointerEvents="none"
      />

      {/* Resolution message */}
      {accepted && otherPersonAccepted && (
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.resolvedOverlay, { opacity: resolvedOpacity }]}
        >
          <Text style={styles.resolvedText}>you worked it out</Text>
        </Animated.View>
      )}

      {/* Main content */}
      <Animated.ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        pointerEvents={accepted && otherPersonAccepted ? 'none' : 'auto'}
      >
        <Wordmark />
        <View style={styles.gap8} />
        <PhasePill label="you found something" tone="olive" />

        <View style={styles.gap20} />
        <DisplayTitle>Here's where you landed</DisplayTitle>
        <View style={styles.gap8} />
        <Text style={styles.subtitle}>Your agents worked this out together.</Text>

        <View style={styles.gap24} />

        <VerdictCard
          label="what you both agreed on"
          body={verdict.sharedAgreement}
          tint={warmColors.successLight}
          delay={100}
        />
        <View style={styles.gap12} />
        <VerdictCard
          label="what this means for you"
          body={verdict.whatItMeansForYou}
          tint={myTint}
          delay={300}
        />
        <View style={styles.gap12} />
        <VerdictCard
          label="what they're walking away with"
          body={verdict.whatTheyGet}
          tint={warmColors.sharedLight}
          delay={500}
        />

        <View style={styles.gap28} />

        {!accepted && (
          <>
            <WarmButton label="this works for me" onPress={handleAccept} />
            <View style={styles.gap12} />
            <WarmButton label="something feels off" variant="ghost" onPress={onDispute} />
          </>
        )}

        {accepted && !otherPersonAccepted && (
          <>
            <View style={styles.gap8} />
            <WaitingPulse />
          </>
        )}

        <View style={styles.gap40} />
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: warmColors.bgPrimary },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 40 },
  subtitle: {
    fontSize: 14,
    color: warmColors.textSecondary,
    lineHeight: 14 * 1.6,
  },
  flash: {
    backgroundColor: warmColors.accentALight,
    zIndex: 10,
  },
  resolvedOverlay: {
    backgroundColor: warmColors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  resolvedText: {
    fontSize: 20,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    textAlign: 'center',
    lineHeight: 20 * 1.6,
  },
  gap8: { height: 8 },
  gap12: { height: 12 },
  gap20: { height: 20 },
  gap24: { height: 24 },
  gap28: { height: 28 },
  gap40: { height: 40 },
});
