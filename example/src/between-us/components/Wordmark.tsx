import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { warmColors } from '../warmColors';

export function Wordmark() {
  return <Text style={styles.wordmark}>between us</Text>;
}

const styles = StyleSheet.create({
  wordmark: {
    fontSize: 13,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    letterSpacing: 0.2,
  },
});
