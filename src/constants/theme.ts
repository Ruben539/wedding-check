import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0f172a',
    background: '#fff1f2',
    backgroundElement: '#ffffff',
    backgroundSelected: '#ffe4e6',
    textSecondary: '#64748b',
    primary: '#e11d48',
    primaryLight: '#fff1f2',
    accent: '#f59e0b',
    accentLight: '#fef3c7',
    border: '#fecdd3',
  },
  dark: {
    text: '#f8fafc',
    background: '#09090b',
    backgroundElement: '#18181b',
    backgroundSelected: '#27272a',
    textSecondary: '#a1a1aa',
    primary: '#fb7185',
    primaryLight: '#31121d',
    accent: '#fbbf24',
    accentLight: '#2e1c0c',
    border: '#27272a',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
