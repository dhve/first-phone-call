export const warmColors = {
  // Backgrounds
  bgPrimary: '#FDFAF6',
  bgSecondary: '#F5EFE6',
  bgTertiary: '#EDE4D8',

  // Text
  textPrimary: '#2C2420',
  textSecondary: '#7A6A5F',
  textTertiary: '#A8998E',

  // Person A — caramel
  accentA: '#8B6F47',
  accentALight: '#F2E8DA',

  // Person B — sage
  accentB: '#5C7A6B',
  accentBLight: '#E0EDE8',

  // Shared / neutral
  shared: '#9E8B7D',
  sharedLight: '#EDE6DF',

  // Status
  success: '#6B8F5E',
  successLight: '#E4EEE0',

  // Borders
  border: 'rgba(44, 36, 32, 0.10)',
  borderMedium: 'rgba(44, 36, 32, 0.18)',
} as const;

export type WarmColor = keyof typeof warmColors;
