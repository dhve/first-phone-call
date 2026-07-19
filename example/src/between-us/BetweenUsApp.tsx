/**
 * BetweenUsApp — root component for the Between Us mediation flow.
 *
 * Mount this instead of (or alongside) the existing DeviceAgent App.
 * All navigation is internal state — no react-navigation dependency needed.
 *
 * Placeholder data is used throughout; wire real agent calls where noted.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { warmColors } from './warmColors';
import type { IntakeAnswer, PersonId, Screen, SessionContext } from './types';

import { Screen0a } from './screens/Screen0a';
import { Screen0b } from './screens/Screen0b';
import { Screen1 } from './screens/Screen1';
import { Screen2 } from './screens/Screen2';
import { Screen3, MOCK_INSIGHT } from './screens/Screen3';
import { Screen4, MOCK_VERDICT } from './screens/Screen4';

/**
 * On a real device, derive the opening screen from a deep-link or push
 * notification. For now, users pick their role from a minimal landing.
 */
function Landing({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return (
    <View style={landingStyles.screen}>
      <Text style={landingStyles.wordmark}>between us</Text>
      <View style={{ height: 40 }} />
      <TouchableOpacity style={landingStyles.primaryBtn} onPress={onHost} activeOpacity={0.8}>
        <Text style={landingStyles.primaryLabel}>start a conversation</Text>
      </TouchableOpacity>
      <View style={{ height: 12 }} />
      <TouchableOpacity style={landingStyles.ghostBtn} onPress={onJoin} activeOpacity={0.8}>
        <Text style={landingStyles.ghostLabel}>someone invited me</Text>
      </TouchableOpacity>
    </View>
  );
}

const landingStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: warmColors.bgPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  wordmark: {
    fontSize: 24,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    letterSpacing: 0.3,
  },
  primaryBtn: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: warmColors.accentA,
  },
  primaryLabel: { fontSize: 15, fontWeight: '500', color: warmColors.bgPrimary },
  ghostBtn: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  ghostLabel: { fontSize: 15, fontWeight: '500', color: warmColors.accentA },
});

type AnyScreen = Screen | 'landing';

export function BetweenUsApp() {
  const [screen, setScreen] = useState<AnyScreen>('landing');
  // Derived from the flow taken: host → 'A', joiner → 'B'. Never shown to users.
  const [personId, setPersonId] = useState<PersonId>('A');
  const [_sessionCtx, setSessionCtx] = useState<SessionContext | null>(null);
  const [_intakeAnswers, setIntakeAnswers] = useState<IntakeAnswer | null>(null);
  const [_round, setRound] = useState(1);

  // Simulate the other person being ready — flip these to wire real sync
  const [otherPersonDebriefReady] = useState(true);
  const [otherPersonAccepted, setOtherPersonAccepted] = useState(false);

  // Shared fade value for all screen transitions
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const transitioning = useRef(false);

  const navigate = useCallback(
    (next: AnyScreen) => {
      if (transitioning.current) return;
      transitioning.current = true;

      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start(() => {
        setScreen(next);
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          transitioning.current = false;
        });
      });
    },
    [fadeAnim]
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={warmColors.bgPrimary} />

      <Animated.View style={[styles.fill, { opacity: fadeAnim }]}>
        {screen === 'landing' && (
          <Landing
            onHost={() => navigate('host')}
            onJoin={() => navigate('join')}
          />
        )}

        {screen === 'host' && (
          <Screen0a
            onSessionReady={(ctx) => {
              setPersonId('A');
              setSessionCtx(ctx);
              navigate('intake');
            }}
          />
        )}

        {screen === 'join' && (
          <Screen0b
            onJoin={(ctx) => {
              setPersonId('B');
              setSessionCtx(ctx);
              navigate('intake');
            }}
            onDecline={() => navigate('landing')}
          />
        )}

        {screen === 'intake' && (
          <Screen1
            onComplete={(answers) => {
              setIntakeAnswers(answers);
              navigate('negotiation');
            }}
          />
        )}

        {screen === 'negotiation' && (
          <Screen2
            personId={personId}
            onRoundComplete={(r) => {
              setRound(r);
              navigate('debrief');
            }}
          />
        )}

        {screen === 'debrief' && (
          <Screen3
            insight={MOCK_INSIGHT}
            otherPersonReady={otherPersonDebriefReady}
            onNextRound={(_followUp) => {
              navigate('verdict');
            }}
          />
        )}

        {screen === 'verdict' && (
          <Screen4
            verdict={MOCK_VERDICT}
            personId={personId}
            otherPersonAccepted={otherPersonAccepted}
            onAccept={() => {
              setTimeout(() => setOtherPersonAccepted(true), 2500);
            }}
            onDispute={() => navigate('debrief')}
          />
        )}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: warmColors.bgPrimary },
  fill: { flex: 1 },
});
