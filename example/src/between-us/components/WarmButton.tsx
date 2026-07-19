import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
} from 'react-native';
import { warmColors } from '../warmColors';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost';
  disabled?: boolean;
  style?: ViewStyle;
}

export function WarmButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: Props) {
  const opacity = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.timing(opacity, {
      toValue: 0.75,
      duration: 80,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  };

  const isPrimary = variant === 'primary';

  return (
    <Animated.View style={[{ opacity }, style]}>
      <Pressable
        style={[
          styles.base,
          isPrimary ? styles.primary : styles.ghost,
          disabled && styles.disabled,
        ]}
        onPress={!disabled ? onPress : undefined}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Text
          style={[
            styles.label,
            isPrimary ? styles.primaryLabel : styles.ghostLabel,
            disabled && styles.disabledLabel,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: warmColors.accentA,
  },
  ghost: {
    backgroundColor: warmColors.bgSecondary,
    borderWidth: 0.5,
    borderColor: warmColors.borderMedium,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  primaryLabel: {
    color: warmColors.bgPrimary,
  },
  ghostLabel: {
    color: warmColors.accentA,
  },
  disabledLabel: {
    color: warmColors.textTertiary,
  },
});
