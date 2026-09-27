import React, { useState } from 'react';
import {
  TextInput,
  View,
  Text,
  StyleSheet,
  Pressable,
  type TextInputProps,
} from 'react-native';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  isPassword?: boolean;
  icon?: string;
}

export function Input({ label, error, isPassword, icon, style, ...rest }: InputProps) {
  const theme = useTheme();
  const [showPassword, setShowPassword] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label ? (
        <Text style={[styles.label, { color: '#000000' }]}>
          {icon ? `${icon} ` : ''}{label}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputWrapper,
          {
            backgroundColor: '#ffffff',
            borderColor: error
              ? '#ef4444'
              : isFocused
              ? '#e11d48'
              : '#cbd5e1',
          },
        ]}>
        <TextInput
          style={[
            styles.input,
            { color: '#000000' },
            style,
          ]}
          placeholderTextColor="#64748b"
          secureTextEntry={isPassword && !showPassword}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          {...rest}
        />
        {isPassword && (
          <Pressable
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeButton}>
            <Text style={[styles.eyeText, { color: theme.textSecondary }]}>
              {showPassword ? '👁️ Ocultar' : '👁️ Ver'}
            </Text>
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.one,
    alignSelf: 'stretch',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
  },
  input: {
    flex: 1,
    fontSize: 15,
    height: '100%',
    fontWeight: '500',
  },
  eyeButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  eyeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
});
