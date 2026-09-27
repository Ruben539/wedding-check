import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Redirect } from 'expo-router';
import { Image } from 'expo-image';

import { useAuth } from '@/context/auth-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function LoginScreen() {
  const { user, login, isLoading: authLoading } = useAuth();
  const theme = useTheme();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (authLoading) {
    return (
      <ThemedView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#e11d48" />
      </ThemedView>
    );
  }

  if (user) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    setErrorMsg(null);
    setLoading(true);

    try {
      await login(username, password);
      router.replace('/');
    } catch (err: any) {
      setErrorMsg(err.message || 'Error de autenticación. Verifica tus credenciales.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            
            {/* Main Form Card (Fondo blanco) */}
            <View style={styles.card}>
              
              {/* Header Oficial Wedding Check Logo */}
              <View style={styles.headerSection}>
                <View style={styles.logoContainer}>
                  <Image
                    source={require('@/assets/images/icon.png')}
                    style={styles.logoImage}
                    contentFit="cover"
                  />
                </View>

                <ThemedText type="subtitle" style={styles.formTitle}>
                  WEDDING CHECK
                </ThemedText>
                <ThemedText style={styles.formSubtitle}>
                  Confirmá. Llegá. Celebrá. ✨
                </ThemedText>
              </View>

              {/* Alerta de Error */}
              {errorMsg ? (
                <View style={styles.errorBox}>
                  <ThemedText style={styles.errorText}>⚠️ {errorMsg}</ThemedText>
                </View>
              ) : null}

              {/* Input Fields */}
              <View style={styles.formFields}>
                <Input
                  label="Usuario"
                  icon="👤"
                  placeholder="Ingresá tu usuario"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <Input
                  label="Contraseña"
                  icon="🔑"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  isPassword
                  autoCapitalize="none"
                />

                {/* Submit Button */}
                <Button
                  title="INICIAR SESIÓN"
                  iconRight="➔"
                  variant="primary"
                  onPress={handleSubmit}
                  loading={loading}
                  style={styles.submitBtn}
                />
              </View>

            </View>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  keyboardView: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: Spacing.five,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 4,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: Spacing.four,
  },
  logoContainer: {
    width: 76,
    height: 76,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: Spacing.three,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  logoImage: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
  },
  formTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0f172a',
    letterSpacing: 1,
  },
  formSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e11d48',
    textAlign: 'center',
    marginTop: 2,
  },
  errorBox: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderWidth: 1,
    borderRadius: 12,
    padding: Spacing.three,
    marginBottom: Spacing.three,
  },
  errorText: {
    color: '#e11d48',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  formFields: {
    gap: 16,
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 2,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#e11d48',
    borderColor: '#e11d48',
  },
  checkmark: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  rememberText: {
    fontSize: 13,
    fontWeight: '600',
  },
  forgotText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e11d48',
  },
  submitBtn: {
    height: 50,
    borderRadius: 14,
    marginTop: 6,
    backgroundColor: '#e11d48',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
