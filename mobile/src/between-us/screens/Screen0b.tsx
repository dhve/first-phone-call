import React, { useState } from 'react';
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
import type { SessionContext } from '../types';

interface Props {
  onJoin: (ctx: SessionContext) => void;
  onDecline: () => void;
}

// Simulated decoded context from QR scan
const MOCK_SCANNED_CONTEXT: SessionContext = {
  situation: 'a deadline that is not working for both of us',
  conversationType: 'Workplace',
  desiredOutcome: 'something we both feel okay about',
};

export function Screen0b({ onJoin, onDecline }: Props) {
  const [name, setName] = useState('');
  const [scanned, setScanned] = useState(false);
  const [scannedCtx, setScannedCtx] = useState<SessionContext | null>(null);

  const handleScan = () => {
    // In real implementation, open camera + parse QR
    setScannedCtx(MOCK_SCANNED_CONTEXT);
    setScanned(true);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Wordmark />
      <View style={styles.gap8} />
      <PhasePill label="joining a session" tone="sage" />

      <View style={styles.gap20} />
      <DisplayTitle>Someone invited you</DisplayTitle>
      <View style={styles.gap8} />
      <Text style={styles.subtitle}>
        Scan their code and your agent will know what you're here to work through.
      </Text>

      <View style={styles.gap28} />

      {!scanned ? (
        <>
          <TouchableOpacity style={styles.viewfinder} onPress={handleScan} activeOpacity={0.8}>
            <View style={styles.scanIcon}>
              <Text style={styles.scanIconText}>⊡</Text>
            </View>
            <Text style={styles.scanHint}>tap to scan</Text>
          </TouchableOpacity>
        </>
      ) : (
        <View style={styles.contextCard}>
          <Text style={styles.contextLabel}>your agent knows the context</Text>
          <View style={styles.gap10} />
          <Text style={styles.contextBody}>
            You're here to work through a{' '}
            <Text style={styles.contextEmphasis}>
              {scannedCtx?.conversationType?.toLowerCase()}
            </Text>{' '}
            conversation.
          </Text>
          <View style={styles.gap6} />
          <Text style={styles.contextBody}>
            The situation: {scannedCtx?.situation}.
          </Text>
          <View style={styles.gap6} />
          <Text style={styles.contextBody}>
            The goal: {scannedCtx?.desiredOutcome}.
          </Text>
        </View>
      )}

      <View style={styles.gap20} />
      <Text style={styles.noteText}>
        Your side of things stays with you — your agent will ask you about it next.
      </Text>

      <View style={styles.gap28} />

      <Text style={styles.fieldLabel}>Your name</Text>
      <View style={styles.gap6} />
      <TextInput
        style={styles.textField}
        value={name}
        onChangeText={setName}
        placeholder="what should your agent call you?"
        placeholderTextColor={warmColors.textTertiary}
        autoCapitalize="words"
        returnKeyType="done"
      />
      <View style={styles.gap20} />

      <WarmButton
        label="I'm in — let's go"
        disabled={!scanned || !name.trim()}
        onPress={() => scannedCtx && onJoin({ ...scannedCtx, name })}
      />
      <View style={styles.gap12} />
      <WarmButton label="this isn't for me" variant="ghost" onPress={onDecline} />

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
  viewfinder: {
    height: 90,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: warmColors.border,
    borderStyle: 'dashed',
    backgroundColor: warmColors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  scanIcon: { alignItems: 'center' },
  scanIconText: { fontSize: 28, color: warmColors.shared },
  scanHint: { fontSize: 12, color: warmColors.textTertiary },
  contextCard: {
    backgroundColor: warmColors.accentBLight,
    borderRadius: 16,
    padding: 16,
    borderWidth: 0.5,
    borderColor: warmColors.accentB + '40',
  },
  contextLabel: {
    fontSize: 11,
    color: warmColors.accentB,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.44,
  },
  contextBody: {
    fontSize: 14,
    color: warmColors.textPrimary,
    lineHeight: 14 * 1.6,
  },
  contextEmphasis: {
    color: warmColors.accentB,
    fontWeight: '500',
  },
  noteText: {
    fontSize: 12,
    color: warmColors.textTertiary,
    textAlign: 'center',
    lineHeight: 12 * 1.6,
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
    height: 44,
  },
  gap6: { height: 6 },
  gap8: { height: 8 },
  gap10: { height: 10 },
  gap12: { height: 12 },
  gap20: { height: 20 },
  gap28: { height: 28 },
  gap40: { height: 40 },
});
