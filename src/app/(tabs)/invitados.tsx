import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth, getAuthHeaders } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { APP_URL } from '@/env';

interface RSVPGuestItem {
  id: number | string;
  name: string;
  phone: string;
  passes: number;
  confirmed_passes?: number;
  table_number?: string | null;
  rsvp_status: 'confirmed' | 'pending_rsvp' | 'declined';
  dietary_restrictions?: string | null;
  notes?: string | null;
}

export default function GuestListRSVPScreen() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { selectedEvent, selectedEventId, refreshEvents } = useEvent();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [guests, setGuests] = useState<RSVPGuestItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterRsvp, setFilterRsvp] = useState<'all' | 'confirmed' | 'pending_rsvp' | 'declined'>('all');

  useEffect(() => {
    if (user && selectedEventId) {
      loadRSVPData(selectedEventId);
    } else {
      setGuests([]);
    }
  }, [user, selectedEventId]);

  const loadRSVPData = async (eventId?: number) => {
    const targetId = eventId || selectedEventId;
    if (!targetId) {
      setGuests([]);
      return;
    }
    setLoading(true);
    const storageKey = `@wedding_check_guests_${targetId}`;
    try {
      // Cargar caché previo del evento específico de inmediato para evitar destellos
      const cached = await AsyncStorage.getItem(storageKey);
      if (cached) {
        try {
          setGuests(JSON.parse(cached));
        } catch {
          // ignore
        }
      } else {
        setGuests([]);
      }

      const headers = getAuthHeaders(user);
      const res = await fetch(`${APP_URL}/events/${targetId}/guests`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        const rawGuests = Array.isArray(data) ? data : (data.guests || data.data || []);
        const list: RSVPGuestItem[] = rawGuests.map((g: any) => ({
          ...g,
          rsvp_status:
            g.rsvp_status === 'confirmed' || g.rsvp_status === 'pending_rsvp' || g.rsvp_status === 'declined'
              ? g.rsvp_status
              : g.status === 'declined'
              ? 'declined'
              : g.status === 'pending'
              ? 'pending_rsvp'
              : 'confirmed',
        }));
        setGuests(list);
        await AsyncStorage.setItem(storageKey, JSON.stringify(list));
      } else {
        // Si hay error en la respuesta del backend, conservamos la caché del evento
        if (!cached) {
          setGuests([]);
        }
      }
    } catch {
      // Offline fallback: los datos cacheados ya fueron cargados
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshEvents();
    if (selectedEventId) {
      await loadRSVPData(selectedEventId);
    }
    setRefreshing(false);
  };

  // Cálculo dinámico de fecha límite de RSVP (7 días antes del evento seleccionado en Config)
  const deadlineInfo = useMemo(() => {
    if (!selectedEvent?.event_date) return null;
    try {
      const cleanDateStr = selectedEvent.event_date.split('T')[0].split(' ')[0];
      const parts = cleanDateStr.includes('-') ? cleanDateStr.split('-') : cleanDateStr.split('/');
      if (parts.length !== 3) return null;
      let year = parseInt(parts[0], 10);
      let month = parseInt(parts[1], 10) - 1;
      let day = parseInt(parts[2], 10);
      if (parts[0].length <= 2 && parts[2].length === 4) {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10) - 1;
        year = parseInt(parts[2], 10);
      }
      if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
      const eventDate = new Date(year, month, day);

      const deadlineDays = 7;
      const deadlineDate = new Date(eventDate);
      deadlineDate.setDate(deadlineDate.getDate() - deadlineDays);

      const now = new Date();
      now.setHours(0, 0, 0, 0);

      const diffTime = deadlineDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const formattedDeadline = deadlineDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      const formattedEventDate = eventDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

      let badgeText = '';
      if (diffDays > 0) {
        badgeText = `⏳ Faltan ${diffDays} día${diffDays === 1 ? '' : 's'} para confirmar lista definitiva de catering`;
      } else if (diffDays === 0) {
        badgeText = `⚠️ ¡Hoy es el último día para confirmar la lista de catering!`;
      } else {
        badgeText = `🔒 El plazo de confirmación previa ha finalizado`;
      }

      return {
        deadlineDays,
        formattedDeadline,
        formattedEventDate,
        badgeText,
      };
    } catch {
      return null;
    }
  }, [selectedEvent?.event_date]);

  // Enviar Recordatorio de RSVP por WhatsApp con datos reales del evento seleccionado
  const sendWhatsAppReminder = (guest: RSVPGuestItem) => {
    const coupleName = selectedEvent?.couple_names || selectedEvent?.title || 'la Boda';
    const deadlineTxt = deadlineInfo ? `antes del ${deadlineInfo.formattedDeadline}` : 'a la brevedad';
    const text = `¡Hola ${guest.name}! 💕 Te recordamos confirmar tu asistencia para ${coupleName} ${deadlineTxt}. ¡Contamos contigo! 🥂`;
    const cleanPhone = (guest.phone || '').replace(/[^\d]/g, '');
    if (!cleanPhone) {
      Alert.alert('Sin teléfono', `El invitado ${guest.name} no tiene un teléfono registrado.`);
      return;
    }
    const url = `https://wa.me/595${cleanPhone.replace(/^0/, '').replace(/^595/, '')}?text=${encodeURIComponent(text)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert('WhatsApp no disponible', `Número del invitado: ${guest.phone}`);
    });
  };

  // Filtrado de invitados
  const filteredGuests = useMemo(() => {
    return guests.filter((g) => {
      const matchQuery =
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.phone && g.phone.includes(searchQuery));

      if (!matchQuery) return false;

      if (filterRsvp === 'confirmed') return g.rsvp_status === 'confirmed';
      if (filterRsvp === 'pending_rsvp') return g.rsvp_status === 'pending_rsvp';
      if (filterRsvp === 'declined') return g.rsvp_status === 'declined';
      return true;
    });
  }, [guests, searchQuery, filterRsvp]);

  // KPIs Pre-Evento (Confirmación RSVP calculados sobre datos reales)
  const rsvpStats = useMemo(() => {
    const total = guests.length;
    const confirmed = guests.filter((g) => g.rsvp_status === 'confirmed').length;
    const pending = guests.filter((g) => g.rsvp_status === 'pending_rsvp').length;
    const declined = guests.filter((g) => g.rsvp_status === 'declined').length;

    const confirmedPasses = guests
      .filter((g) => g.rsvp_status === 'confirmed')
      .reduce((acc, g) => acc + (Number(g.confirmed_passes) || Number(g.passes) || 1), 0);

    const confirmedGuestsList = guests.filter((g) => g.rsvp_status === 'confirmed');
    const lactoseCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('lactosa')).length;
    const celiacCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('tacc') || g.dietary_restrictions?.toLowerCase().includes('celíac')).length;
    const veggieCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('vegetar') || g.dietary_restrictions?.toLowerCase().includes('vegan')).length;
    const totalSpecialCount = lactoseCount + celiacCount + veggieCount;
    const standardPasses = Math.max(0, confirmedPasses - totalSpecialCount);

    return { total, confirmed, pending, declined, confirmedPasses, lactoseCount, celiacCount, veggieCount, totalSpecialCount, standardPasses };
  }, [guests]);

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
            <ThemedText style={styles.headerSubtitle}>
              {selectedEvent?.title ? `BODA: ${selectedEvent.title.toUpperCase()}` : 'GESTIÓN PREVIA DE BODA'}
            </ThemedText>
            <ThemedText type="subtitle" style={styles.headerTitle}>Lista de Invitados & RSVP</ThemedText>
            {selectedEvent?.event_date ? (
              <ThemedText style={styles.headerEventDate}>
                📅 {selectedEvent.event_date} {selectedEvent.location ? `· 📍 ${selectedEvent.location}` : ''}
              </ThemedText>
            ) : null}
          </View>

          <Pressable
            onPress={handleRefresh}
            disabled={refreshing || loading}
            style={styles.refreshBtn}>
            {refreshing || loading ? (
              <ActivityIndicator size="small" color="#e11d48" />
            ) : (
              <ThemedText style={styles.refreshBtnText}>🔄 Actualizar</ThemedText>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#e11d48']} />
          }>

          {!selectedEvent ? (
            <View style={styles.noEventCard}>
              <ThemedText style={styles.noEventIcon}>⚠️</ThemedText>
              <ThemedText style={styles.noEventTitle}>Ningún Evento Seleccionado</ThemedText>
              <ThemedText style={styles.noEventSub}>
                Ingresá a la pestaña "Info Boda" para seleccionar el evento que deseas gestionar.
              </ThemedText>
            </View>
          ) : (
            <>
              {/* BANNER REGLA 7 DÍAS ANTES DEL EVENTO */}
              <LinearGradient
                colors={['#fff7ed', '#ffedd5']}
                style={styles.deadlineBanner}>
                <View style={styles.deadlineIconBox}>
                  <ThemedText style={styles.deadlineIcon}>⏰</ThemedText>
                </View>
                <View style={styles.deadlineCol}>
                  <ThemedText style={styles.deadlineTitle}>
                    Cierre de RSVP: 7 Días Antes del Evento
                  </ThemedText>
                  {deadlineInfo ? (
                    <>
                      <ThemedText style={styles.deadlineSub}>
                        Fecha Límite: <ThemedText style={{ fontWeight: '900' }}>{deadlineInfo.formattedDeadline}</ThemedText> (Boda: {deadlineInfo.formattedEventDate}).
                      </ThemedText>
                      <ThemedText style={styles.deadlineBadge}>
                        {deadlineInfo.badgeText}
                      </ThemedText>
                    </>
                  ) : (
                    <ThemedText style={styles.deadlineSub}>
                      {selectedEvent.event_date
                        ? `Fecha del evento: ${selectedEvent.event_date}`
                        : 'Fecha no definida aún en la configuración del evento.'}
                    </ThemedText>
                  )}
                </View>
              </LinearGradient>

              {/* KPIs PRE-EVENTO (CONFIRMACIÓN RSVP) */}
              <View style={styles.statsRow}>
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.statCard}>
                  <ThemedText style={styles.statNumber}>
                    {rsvpStats.confirmed}
                  </ThemedText>
                  <ThemedText style={styles.statLabel}>
                    🟢 CONFIRMARON
                  </ThemedText>
                  <ThemedText style={styles.statSub}>
                    {rsvpStats.confirmedPasses} pases totales
                  </ThemedText>
                </LinearGradient>

                <View style={styles.statCardSecondary}>
                  <ThemedText style={styles.statNumberAmber}>
                    {rsvpStats.pending}
                  </ThemedText>
                  <ThemedText style={styles.statLabelDark}>
                    ⏳ PENDIENTES
                  </ThemedText>
                  <ThemedText style={styles.statSubDark}>
                    Sin responder
                  </ThemedText>
                </View>

                <View style={styles.statCardSecondary}>
                  <ThemedText style={styles.statNumberRed}>
                    {rsvpStats.declined}
                  </ThemedText>
                  <ThemedText style={styles.statLabelDark}>
                    🔴 DECLINARON
                  </ThemedText>
                  <ThemedText style={styles.statSubDark}>
                    No asistirán
                  </ThemedText>
                </View>
              </View>

              {/* DESGLOSE DE CATERING Y MENÚ DEFINITIVO */}
              <View style={styles.cateringCard}>
                <View style={styles.cateringHeaderCol}>
                  <ThemedText style={styles.cateringCardTitle}>🥗 Desglose de Catering para Proveedor</ThemedText>
                  <ThemedText style={styles.cateringCardSub}>
                    El menú de la boda es uno solo. Las observaciones aplican únicamente al invitado que las especificó:
                  </ThemedText>
                </View>

                <View style={styles.cateringPillsRow}>
                  <View style={styles.pillStandard}>
                    <ThemedText style={styles.pillStandardText}>
                      🍽️ {rsvpStats.standardPasses} Menús Estándar
                    </ThemedText>
                  </View>

                  {rsvpStats.lactoseCount > 0 && (
                    <View style={styles.pillSpecial}>
                      <ThemedText style={styles.pillSpecialText}>
                        🥛 {rsvpStats.lactoseCount} Sin Lactosa
                      </ThemedText>
                    </View>
                  )}

                  {rsvpStats.celiacCount > 0 && (
                    <View style={styles.pillSpecial}>
                      <ThemedText style={styles.pillSpecialText}>
                        🌾 {rsvpStats.celiacCount} Celíaco (Sin TACC)
                      </ThemedText>
                    </View>
                  )}

                  {rsvpStats.veggieCount > 0 && (
                    <View style={styles.pillSpecial}>
                      <ThemedText style={styles.pillSpecialText}>
                        🌱 {rsvpStats.veggieCount} Vegetariano
                      </ThemedText>
                    </View>
                  )}
                </View>
              </View>

              {/* Búsqueda y Filtros RSVP */}
              <View style={styles.searchSection}>
                <View style={styles.searchInputWrapper}>
                  <ThemedText style={styles.searchIcon}>🔍</ThemedText>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Buscar por nombre o teléfono..."
                    placeholderTextColor="#64748b"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                  />
                  {searchQuery.length > 0 && (
                    <Pressable onPress={() => setSearchQuery('')} style={styles.clearBtn}>
                      <ThemedText style={styles.clearText}>✕</ThemedText>
                    </Pressable>
                  )}
                </View>

                {/* Filtros de RSVP */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPills}>
                  <Pressable
                    onPress={() => setFilterRsvp('all')}
                    style={[styles.pill, filterRsvp === 'all' && styles.pillActive]}>
                    <ThemedText style={[styles.pillText, filterRsvp === 'all' && styles.pillTextActive]}>
                      Todos ({guests.length})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterRsvp('confirmed')}
                    style={[styles.pill, filterRsvp === 'confirmed' && styles.pillActiveGreen]}>
                    <ThemedText style={[styles.pillText, filterRsvp === 'confirmed' && styles.pillTextActive]}>
                      🟢 Confirmaron ({rsvpStats.confirmed})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterRsvp('pending_rsvp')}
                    style={[styles.pill, filterRsvp === 'pending_rsvp' && styles.pillActiveAmber]}>
                    <ThemedText style={[styles.pillText, filterRsvp === 'pending_rsvp' && styles.pillTextActive]}>
                      ⏳ Pendientes RSVP ({rsvpStats.pending})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterRsvp('declined')}
                    style={[styles.pill, filterRsvp === 'declined' && styles.pillActiveRed]}>
                    <ThemedText style={[styles.pillText, filterRsvp === 'declined' && styles.pillTextActive]}>
                      🔴 Declinaron ({rsvpStats.declined})
                    </ThemedText>
                  </Pressable>
                </ScrollView>
              </View>

              {/* LISTA DE INVITADOS CON ESTADO RSVP */}
              <View style={styles.guestListSection}>
                <ThemedText style={styles.sectionTitle}>
                  ESTADO DE INVITADOS PARA EL CATERING ({filteredGuests.length})
                </ThemedText>

                {loading && guests.length === 0 ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#e11d48" />
                    <ThemedText style={styles.loadingText}>Cargando lista de invitados desde el servidor...</ThemedText>
                  </View>
                ) : filteredGuests.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <ThemedText style={styles.emptyIcon}>📋</ThemedText>
                    <ThemedText style={styles.emptyTitle}>
                      {searchQuery || filterRsvp !== 'all'
                        ? 'No se encontraron invitados con ese filtro'
                        : 'No hay invitados registrados para esta boda'}
                    </ThemedText>
                    <ThemedText style={styles.emptySub}>
                      {searchQuery || filterRsvp !== 'all'
                        ? 'Probá modificando el texto de búsqueda o quitando los filtros de RSVP.'
                        : 'Los invitados se sincronizan en tiempo real con la base de datos del evento.'}
                    </ThemedText>
                  </View>
                ) : (
                  filteredGuests.map((guest) => {
                    const isConfirmed = guest.rsvp_status === 'confirmed';
                    const isDeclined = guest.rsvp_status === 'declined';

                    return (
                      <View key={guest.id} style={styles.guestCard}>
                        <View style={styles.guestInfoCol}>
                          <View style={styles.guestNameRow}>
                            <ThemedText style={styles.guestName}>{guest.name}</ThemedText>

                            {isConfirmed ? (
                              <View style={styles.badgeConfirmed}>
                                <ThemedText style={styles.badgeConfirmedText}>🟢 CONFIRMADO</ThemedText>
                              </View>
                            ) : isDeclined ? (
                              <View style={styles.badgeDeclined}>
                                <ThemedText style={styles.badgeDeclinedText}>🔴 DECLINÓ</ThemedText>
                              </View>
                            ) : (
                              <View style={styles.badgePending}>
                                <ThemedText style={styles.badgePendingText}>⏳ PENDIENTE RSVP</ThemedText>
                              </View>
                            )}
                          </View>

                          <View style={styles.detailsRow}>
                            <ThemedText style={styles.detailText}>
                              🎟️ Pases: {guest.confirmed_passes || guest.passes || 1} personas
                            </ThemedText>
                            {guest.table_number ? (
                              <ThemedText style={styles.detailText}>
                                🪑 {guest.table_number}
                              </ThemedText>
                            ) : (
                              <ThemedText style={styles.detailSubtle}>Sin mesa asignada</ThemedText>
                            )}
                          </View>

                          {guest.dietary_restrictions ? (
                            <View style={styles.dietBox}>
                              <ThemedText style={styles.dietText}>🥗 {guest.dietary_restrictions}</ThemedText>
                            </View>
                          ) : null}

                          {guest.notes ? (
                            <ThemedText style={styles.notesText} themeColor="textSecondary">
                              📝 {guest.notes}
                            </ThemedText>
                          ) : null}
                        </View>

                        {!isConfirmed && (
                          <Pressable
                            onPress={() => sendWhatsAppReminder(guest)}
                            style={styles.reminderBtn}>
                            <ThemedText style={styles.reminderBtnText}>📲 Recordatorio</ThemedText>
                          </Pressable>
                        )}
                      </View>
                    );
                  })
                )}
              </View>
            </>
          )}

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 160,
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
  headerEventDate: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 2,
  },
  refreshBtn: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecdd3',
    minWidth: 95,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e11d48',
  },

  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },

  /* Banner Límite 7 días */
  deadlineBanner: {
    borderRadius: 18,
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  deadlineIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ea580c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deadlineIcon: {
    fontSize: 22,
  },
  deadlineCol: {
    flex: 1,
    gap: 3,
  },
  deadlineTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#9a3412',
  },
  deadlineSub: {
    fontSize: 12,
    color: '#c2410c',
  },
  deadlineBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ea580c',
    marginTop: 2,
  },

  /* KPIs Pre-Evento */
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1.2,
    paddingHorizontal: 10,
    paddingVertical: Spacing.three,
    borderRadius: 16,
    justifyContent: 'center',
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '900',
  },
  statLabel: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statSub: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11,
    fontWeight: '600',
  },
  statCardSecondary: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: Spacing.three,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
  },
  statNumberAmber: {
    color: '#d97706',
    fontSize: 22,
    fontWeight: '900',
  },
  statNumberRed: {
    color: '#e11d48',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabelDark: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '800',
  },
  cateringCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  cateringHeaderCol: {
    gap: 2,
  },
  cateringCardTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
  },
  cateringCardSub: {
    fontSize: 11,
    color: '#64748b',
  },
  cateringPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  pillStandard: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pillStandardText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  pillSpecial: {
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pillSpecialText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#c2410c',
  },
  statSubDark: {
    color: '#94a3b8',
    fontSize: 10,
  },

  /* Búsqueda */
  searchSection: {
    gap: 12,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    height: 50,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#000000',
    fontWeight: '600',
  },
  clearBtn: {
    padding: 4,
  },
  clearText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '700',
  },
  filterPills: {
    gap: 8,
  },
  pill: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  pillActive: {
    backgroundColor: '#0f172a',
    borderColor: '#0f172a',
  },
  pillActiveGreen: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  pillActiveAmber: {
    backgroundColor: '#d97706',
    borderColor: '#d97706',
  },
  pillActiveRed: {
    backgroundColor: '#e11d48',
    borderColor: '#e11d48',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  pillTextActive: {
    color: '#ffffff',
  },

  /* Lista de Invitados */
  guestListSection: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 1,
  },
  guestCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  guestInfoCol: {
    flex: 1,
    gap: 6,
  },
  guestNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  guestName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  badgeConfirmed: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeConfirmedText: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  badgePending: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgePendingText: {
    color: '#b45309',
    fontSize: 10,
    fontWeight: '800',
  },
  badgeDeclined: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeDeclinedText: {
    color: '#be123c',
    fontSize: 10,
    fontWeight: '800',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  detailSubtle: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  dietBox: {
    backgroundColor: '#fff7ed',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  dietText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#c2410c',
  },
  notesText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  reminderBtn: {
    backgroundColor: '#25d366',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  reminderBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  /* Empty & Loading States */
  loadingContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  emptyContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
  noEventCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 18,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#fed7aa',
  },
  noEventIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  noEventTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#9a3412',
    textAlign: 'center',
  },
  noEventSub: {
    fontSize: 13,
    color: '#c2410c',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
});
