import React, { useState, useRef, useEffect } from 'react';
import {
  Animated,
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
import { DisplayTitle } from '../components/DisplayTitle';
import { WarmButton } from '../components/WarmButton';
import type { ConversationType, SessionContext } from '../types';

interface Props {
  onSessionReady: (ctx: SessionContext) => void;
}

const CONVERSATION_TYPES: ConversationType[] = [
  'Workplace',
  'Personal',
  'Financial',
  'Living together',
  'Other',
];

export function Screen0a({ onSessionReady }: Props) {
  const [name, setName] = useState('');
  const [situation, setSituation] = useState('');
  const [convType, setConvType] = useState<ConversationType | null>(null);
  const [outcome, setOutcome] = useState('');

  const [personBJoined, setPersonBJoined] = useState(false);
  const buttonPulse = useRef(new Animated.Value(1)).current;

  const canGenerate = name.trim().length > 0 && situation.trim().length > 0 && convType !== null;

  const contextSummary = canGenerate
    ? `A ${convType?.toLowerCase()} conversation about "${situation.slice(0, 60)}${situation.length > 60 ? '…' : ''}". Goal: ${outcome || 'not specified yet'}.`
    : 'Fill in the fields above to see a preview.';

  useEffect(() => {
    if (!personBJoined) return;
    // Pulse button once, then hand off to router's cross-fade after 1.5s
    Animated.sequence([
      Animated.timing(buttonPulse, { toValue: 0.85, duration: 150, useNativeDriver: true }),
      Animated.timing(buttonPulse, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      onSessionReady({ name, situation, conversationType: convType!, desiredOutcome: outcome });
    }, 1500);
    return () => clearTimeout(timer);
  }, [personBJoined]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Wordmark />
        <View style={styles.gap8} />
        <PhasePill label="starting a session" tone="caramel" />

        <View style={styles.gap20} />
        <DisplayTitle>What's this about?</DisplayTitle>
        <View style={styles.gap8} />
        <Text style={styles.subtitle}>
          This gives both of your agents the same starting point. Your personal side of things comes later, just for your agent.
        </Text>

        <View style={styles.gap24} />

        <Text style={styles.fieldLabel}>Your name</Text>
        <View style={styles.gap6} />
        <TextInput
          style={[styles.textField, styles.textFieldSingle]}
          value={name}
          onChangeText={setName}
          placeholder="what should your agent call you?"
          placeholderTextColor={warmColors.textTertiary}
          autoCapitalize="words"
          returnKeyType="next"
        />

        <View style={styles.gap20} />
        <Text style={styles.fieldLabel}>Describe the situation</Text>
        <View style={styles.gap6} />
        <TextInput
          style={styles.textField}
          value={situation}
          onChangeText={setSituation}
          placeholder="e.g. we need to sort out a deadline that's not working for both of us"
          placeholderTextColor={warmColors.textTertiary}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.gap20} />
        <Text style={styles.fieldLabel}>What kind of conversation is this?</Text>
        <View style={styles.gap8} />
        <View style={styles.tagRow}>
          {CONVERSATION_TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tag, convType === t && styles.tagSelected]}
              onPress={() => setConvType(t)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tagText, convType === t && styles.tagTextSelected]}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.gap20} />
        <Text style={styles.fieldLabel}>What would a good outcome look like?</Text>
        <View style={styles.gap6} />
        <TextInput
          style={styles.textField}
          value={outcome}
          onChangeText={setOutcome}
          placeholder="e.g. something we both feel okay about"
          placeholderTextColor={warmColors.textTertiary}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.gap20} />

        {/* Context preview card */}
        <View style={styles.previewCard}>
          <View style={styles.previewHeader}>
            <Text style={styles.lockIcon}>🔒</Text>
            <Text style={styles.previewLabel}>what your agent will share</Text>
          </View>
          <Text style={styles.previewBody}>{contextSummary}</Text>
        </View>
        <View style={styles.gap8} />
        <Text style={styles.noteText}>nothing personal goes in here — just the frame</Text>

        <View style={styles.gap28} />

        {/* QR code placeholder */}
        <View style={styles.qrWrapper}>
          <View style={styles.qrBox}>
            <Text style={styles.qrPlaceholder}>QR</Text>
          </View>
        </View>

        <View style={styles.gap20} />

        <Animated.View style={{ transform: [{ scale: buttonPulse }] }}>
          <WarmButton
            label={personBJoined ? "they're in — setting up…" : 'waiting for them to scan…'}
            variant="ghost"
            disabled={!canGenerate || personBJoined}
          />
        </Animated.View>

        {/* Demo trigger — remove when real Bluetooth is wired */}
        {canGenerate && !personBJoined && (
          <>
            <View style={styles.gap12} />
            <TouchableOpacity onPress={() => setPersonBJoined(true)}>
              <Text style={styles.demoTrigger}>[demo: simulate scan]</Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.gap40} />
      </ScrollView>
    </View>
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
  fieldLabel: {
    fontSize: 12,
    color: warmColors.textSecondary,
    fontWeight: '500',
  },
  textField: {
    backgroundColor: warmColors.bgSecondary,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: warmColors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: warmColors.textPrimary,
    lineHeight: 14 * 1.6,
    minHeight: 72,
  },
  textFieldSingle: {
    minHeight: 44,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 24,
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.border,
  },
  tagSelected: {
    backgroundColor: warmColors.accentALight,
    borderColor: warmColors.accentA,
  },
  tagText: { fontSize: 13, color: warmColors.textSecondary, fontWeight: '400' },
  tagTextSelected: { color: warmColors.accentA, fontWeight: '500' },
  previewCard: {
    backgroundColor: warmColors.accentALight,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  previewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  lockIcon: { fontSize: 11 },
  previewLabel: {
    fontSize: 11,
    color: warmColors.accentA,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.44,
  },
  previewBody: {
    fontSize: 13,
    color: warmColors.textPrimary,
    lineHeight: 13 * 1.6,
  },
  noteText: {
    fontSize: 12,
    color: warmColors.textTertiary,
    textAlign: 'center',
  },
  qrWrapper: { alignItems: 'center' },
  qrBox: {
    width: 100,
    height: 100,
    borderRadius: 12,
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrPlaceholder: {
    fontSize: 20,
    color: warmColors.textTertiary,
    fontFamily: 'Georgia',
  },
  demoTrigger: {
    fontSize: 11,
    color: warmColors.textTertiary,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
  gap6: { height: 6 },
  gap8: { height: 8 },
  gap12: { height: 12 },
  gap20: { height: 20 },
  gap24: { height: 24 },
  gap28: { height: 28 },
  gap40: { height: 40 },
});
