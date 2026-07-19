import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { warmColors } from '../warmColors';

type PillTone = 'caramel' | 'sage' | 'taupe' | 'olive';

interface Props {
  label: string;
  tone?: PillTone;
}

const toneMap: Record<PillTone, { bg: string; text: string }> = {
  caramel: { bg: warmColors.accentALight, text: warmColors.accentA },
  sage: { bg: warmColors.accentBLight, text: warmColors.accentB },
  taupe: { bg: warmColors.sharedLight, text: warmColors.shared },
  olive: { bg: warmColors.successLight, text: warmColors.success },
};

export function PhasePill({ label, tone = 'caramel' }: Props) {
  const { bg, text } = toneMap[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 24,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.04 * 11,
    textTransform: 'uppercase',
  },
});
