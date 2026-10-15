import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as Network from 'expo-network';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { hasInternet } from '@/utils/network';

// Modal que avisa al usuario cuando no hay conexión a internet.
// Se verifica cada vez que se ingresa a una pantalla y cuando cambia el estado de la red.
export function OfflineModal() {
  const pathname = usePathname();
  const [visible, setVisible] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);

  // Verificar conexión al ingresar a cada pantalla
  useEffect(() => {
    let active = true;
    hasInternet().then((online) => {
      if (active && !online) setVisible(true);
    });
    return () => {
      active = false;
    };
  }, [pathname]);

  // Mostrar si se pierde la conexión y cerrar automáticamente al recuperarla
  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      hasInternet(state).then((online) => setVisible(!online));
    });
    return () => subscription.remove();
  }, []);

  const handleRetry = async () => {
    setChecking(true);
    try {
      setVisible(!(await hasInternet()));
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.iconBox}>
            <Ionicons name="cloud-offline-outline" size={36} color="#e11d48" />
          </View>

          <ThemedText style={styles.title}>No tenés conexión a internet</ThemedText>
          <ThemedText style={styles.message}>
            Revisá tu conexión Wi-Fi o datos móviles. Mientras tanto se mostrará la última información guardada en el
            dispositivo.
          </ThemedText>

          <View style={styles.actions}>
            <Pressable onPress={() => setVisible(false)} style={styles.secondaryBtn}>
              <ThemedText style={styles.secondaryBtnText}>Entendido</ThemedText>
            </Pressable>
            <Pressable onPress={handleRetry} disabled={checking} style={styles.primaryBtn}>
              {checking ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <ThemedText style={styles.primaryBtnText}>Reintentar</ThemedText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  iconBox: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#fff1f2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    width: '100%',
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#334155',
  },
  primaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#e11d48',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
  },
});
