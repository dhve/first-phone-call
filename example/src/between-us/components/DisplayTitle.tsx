import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { warmColors } from '../warmColors';

interface Props {
  children: string;
}

export function DisplayTitle({ children }: Props) {
  return <Text style={styles.title}>{children}</Text>;
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontFamily: 'Georgia',
    color: warmColors.textPrimary,
    lineHeight: 28,
    fontWeight: '400',
  },
});
