import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { useTheme } from '@/hooks/use-theme';

export default function ConfigScreen() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { events, selectedEvent, selectedEventId, setSelectedEventId, isLoading: loading, refreshEvents } = useEvent();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  // Opciones de configuración
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [autoCheckIn, setAutoCheckIn] = useState<boolean>(true);

  if (authLoading) {
    return (
      <ThemedView style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#e11d48" />
      </ThemedView>
    );
  }

  if (!user) {
    return <Redirect href="/login" />;
  }


  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>

        {/* Top Header */}
        <View style={styles.headerBar}>
          <View style={styles.headerTitleCol}>
            <ThemedText style={styles.headerSubtitle}>INFORMACIÓN & AJUSTES</ThemedText>
            <ThemedText type="subtitle" style={styles.headerTitle}>Configuración del Evento</ThemedText>
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refreshEvents} colors={['#e11d48']} />
          }>

          {/* TARJETA DEL EVENTO ACTIVO */}
          {selectedEvent && (
            <LinearGradient
              colors={['#FF0055', '#E61E50', '#F97316']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.eventHeroCard}>
              <View style={styles.heroBadgeRow}>
                <Ionicons name="heart" size={18} color="#ffffff" />
                <ThemedText style={styles.heroBadgeText}>EVENTO SELECCIONADO</ThemedText>
              </View>

              <ThemedText style={styles.heroTitle}>{selectedEvent.title}</ThemedText>

              <View style={styles.heroInfoGrid}>
                <View style={styles.heroInfoItem}>
                  <Ionicons name="calendar-outline" size={16} color="rgba(255, 255, 255, 0.9)" />
                  <ThemedText style={styles.heroInfoText}>{selectedEvent.event_date}</ThemedText>
                </View>

                {selectedEvent.location ? (
                  <View style={styles.heroInfoItem}>
                    <Ionicons name="location-outline" size={16} color="rgba(255, 255, 255, 0.9)" />
                    <ThemedText style={styles.heroInfoText}>{selectedEvent.location}</ThemedText>
                  </View>
                ) : null}

                <View style={styles.heroInfoItem}>
                  <Ionicons name="people-outline" size={16} color="rgba(255, 255, 255, 0.9)" />
                  <ThemedText style={styles.heroInfoText}>
                    {selectedEvent.guest_count || 156} invitados registrados
                  </ThemedText>
                </View>
              </View>
            </LinearGradient>
          )}

          {/* SELECTOR DE EVENTOS (MULTI-EVENTO) */}
          <View style={styles.sectionContainer}>
            <ThemedText style={styles.sectionTitle}>MIS EVENTOS Y BODAS</ThemedText>
            <ThemedText style={styles.sectionSubtitle}>
              Seleccioná qué boda estás gestionando en este momento:
            </ThemedText>

            <View style={styles.eventList}>
              {events.map((ev) => {
                const isSelected = ev.id === selectedEventId;

                return (
                  <Pressable
                    key={ev.id}
                    onPress={() => {
                      setSelectedEventId(ev.id);
                      Alert.alert('Evento Cambiado', `Ahora estás gestionando: ${ev.title}`);
                    }}
                    style={[
                      styles.eventSelectCard,
                      isSelected && styles.eventSelectCardActive,
                    ]}>
                    <View style={styles.eventSelectIconBox}>
                      <Ionicons
                        name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                        size={22}
                        color={isSelected ? '#e11d48' : '#94a3b8'}
                      />
                    </View>

                    <View style={styles.eventSelectCol}>
                      <ThemedText style={[styles.eventSelectTitle, isSelected && styles.eventSelectTitleActive]}>
                        {ev.title}
                      </ThemedText>
                      <ThemedText style={styles.eventSelectSub}>
                        📍 {ev.location} · 📅 {ev.event_date}
                      </ThemedText>
                    </View>

                    {isSelected && (
                      <View style={styles.activeCheckBadge}>
                        <ThemedText style={styles.activeCheckText}>ACTIVO</ThemedText>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* PERFIL DEL ORGANIZADOR */}
          <View style={styles.sectionContainer}>
            <ThemedText style={styles.sectionTitle}>PERFIL DE USUARIO</ThemedText>

            <View style={styles.profileCard}>
              <View style={styles.profileAvatarBox}>
                <Ionicons name="person-circle-outline" size={48} color="#e11d48" />
              </View>

              <View style={styles.profileInfoCol}>
                <ThemedText style={styles.profileName}>{user.name}</ThemedText>
                <ThemedText style={styles.profileEmail}>{user.email}</ThemedText>
                <View style={styles.roleBadge}>
                  <ThemedText style={styles.roleBadgeText}>
                    💍 {user.role || 'Wedding Planner / Coordinador'}
                  </ThemedText>
                </View>
              </View>
            </View>
          </View>

          {/* PREFERENCIAS DE LA APP */}
          <View style={styles.sectionContainer}>
            <ThemedText style={styles.sectionTitle}>PREFERENCIAS DE ESCANEO</ThemedText>

            <View style={styles.settingRow}>
              <View style={styles.settingCol}>
                <ThemedText style={styles.settingTitle}>Sonido de Validación</ThemedText>
                <ThemedText style={styles.settingSub}>Emitir beep al escanear QR en puerta</ThemedText>
              </View>
              <Switch
                value={soundEnabled}
                onValueChange={setSoundEnabled}
                trackColor={{ false: '#cbd5e1', true: '#fecdd3' }}
                thumbColor={soundEnabled ? '#e11d48' : '#94a3b8'}
              />
            </View>

            <View style={styles.settingRow}>
              <View style={styles.settingCol}>
                <ThemedText style={styles.settingTitle}>Check-in Automático</ThemedText>
                <ThemedText style={styles.settingSub}>Acreditar al instante sin confirmar modal</ThemedText>
              </View>
              <Switch
                value={autoCheckIn}
                onValueChange={setAutoCheckIn}
                trackColor={{ false: '#cbd5e1', true: '#fecdd3' }}
                thumbColor={autoCheckIn ? '#e11d48' : '#94a3b8'}
              />
            </View>
          </View>

          {/* BOTÓN DE CIERRE DE SESIÓN */}
          <Button
            title="🚪 CERRAR SESIÓN"
            variant="secondary"
            onPress={() => {
              Alert.alert('Cerrar Sesión', '¿Deseas salir de la aplicación?', [
                { text: 'Cancelar', style: 'cancel' },
                { text: 'Salir', style: 'destructive', onPress: logout },
              ]);
            }}
            style={{ marginBottom: Spacing.four, borderColor: '#e11d48', borderWidth: 1 }}
          />

        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  headerBar: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitleCol: {
    gap: 2,
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#e11d48',
    letterSpacing: 1.2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
  },
  scrollContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
    alignSelf: 'center',
  },

  /* Tarjeta Hero Evento */
  eventHeroCard: {
    width: '100%',
    borderRadius: 20,
    padding: Spacing.four,
    gap: 12,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    overflow: 'hidden',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    width: '100%',
  },
  heroInfoGrid: {
    gap: 6,
    marginTop: 4,
    width: '100%',
  },
  heroInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  heroInfoText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 12,
    color: '#ffffff',
    fontWeight: '600',
  },

  /* Secciones */
  sectionContainer: {
    width: '100%',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 1,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748b',
  },

  /* Lista de Selección de Eventos */
  eventList: {
    width: '100%',
    gap: 8,
  },
  eventSelectCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  eventSelectCardActive: {
    borderColor: '#e11d48',
    backgroundColor: '#fff1f2',
  },
  eventSelectIconBox: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  eventSelectCol: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  eventSelectTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1e293b',
  },
  eventSelectTitleActive: {
    color: '#be123c',
  },
  eventSelectSub: {
    fontSize: 11,
    color: '#64748b',
  },
  activeCheckBadge: {
    backgroundColor: '#e11d48',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    flexShrink: 0,
  },
  activeCheckText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#ffffff',
  },

  /* Perfil */
  profileCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatarBox: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileInfoCol: {
    flex: 1,
    flexShrink: 1,
    gap: 3,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  profileEmail: {
    fontSize: 12,
    color: '#64748b',
  },
  roleBadge: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#e11d48',
  },

  /* Ajustes */
  settingRow: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  settingCol: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
    marginRight: 8,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  settingSub: {
    fontSize: 12,
    color: '#64748b',
  },

  logoutBtn: {
    width: '100%',
    marginTop: 10,
    borderColor: '#fecdd3',
  },
});
