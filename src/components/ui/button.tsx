import React from 'react';
import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ButtonProps extends PressableProps {
  title: string;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'adminDemo' | 'plannerDemo' | 'dark';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  iconRight?: string;
}

export function Button({
  title,
  icon,
  iconRight,
  variant = 'primary',
  loading = false,
  disabled,
  style,
  textStyle,
  ...rest
}: ButtonProps) {
  const theme = useTheme();

  const getBackgroundColor = (pressed: boolean) => {
    if (disabled || loading) return '#cbd5e1';
    switch (variant) {
      case 'dark':
        return pressed ? '#27272a' : '#18181b';
      case 'primary':
        return pressed ? '#be123c' : '#e11d48';
      case 'secondary':
        return pressed ? theme.backgroundSelected : theme.backgroundElement;
      case 'outline':
        return pressed ? theme.backgroundElement : 'transparent';
      case 'danger':
        return pressed ? '#dc2626' : '#ef4444';
      case 'adminDemo':
        return pressed ? '#fde68a' : '#fffbeb';
      case 'plannerDemo':
        return pressed ? '#fecdd3' : '#fff1f2';
      default:
        return '#e11d48';
    }
  };

  const getTextColor = () => {
    if (variant === 'adminDemo') return '#d97706';
    if (variant === 'plannerDemo') return '#e11d48';
    if (variant === 'outline' || variant === 'secondary') return theme.text;
    return '#ffffff';
  };

  const getBorderColor = () => {
    if (variant === 'adminDemo') return '#fde68a';
    if (variant === 'plannerDemo') return '#fecdd3';
    if (variant === 'outline') return theme.border;
    return 'transparent';
  };

  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: getBackgroundColor(pressed),
          borderColor: getBorderColor(),
          borderWidth: variant === 'outline' || variant === 'adminDemo' || variant === 'plannerDemo' ? 1.5 : 0,
        },
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={getTextColor()} size="small" />
      ) : (
        <Text style={[styles.text, { color: getTextColor() }, textStyle]}>
          {icon ? `${icon} ` : ''}{title}{iconRight ? ` ${iconRight}` : ''}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    alignSelf: 'stretch',
    flexDirection: 'row',
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
