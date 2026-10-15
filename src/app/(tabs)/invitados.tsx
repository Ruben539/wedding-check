import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  FlatList,
  Platform,
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
import { Ionicons } from '@expo/vector-icons';

import { useAuth, getAuthHeaders } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { APP_URL } from '@/env';
import { companionsMatch, getCompanionsLabel, getGuestPasses, getRsvpStatus } from '@/utils/guests';
import { useGuests } from '@/context/guests-context';
import { GuestHistoryModal } from '@/components/guest-history-modal';
import { RsvpGuestCard, type RSVPGuestItem } from '@/features/invitados/rsvp-guest-card';

// Local phone (0981..., 981...) -> 595981...; numbers already international are kept as they are
const toWhatsAppNumber = (phone: string): string => {
  const digits = (phone || '').replace(/[^\d]/g, '');
  if (digits.startsWith('595')) return digits;
  if (digits.startsWith('0')) return `595${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('9')) return `595${digits}`;
  return digits;
};

// Accepts aaaa-mm-dd (optionally with time) or dd/mm/aaaa
const parseDateOnly = (raw?: string | null): Date | null => {
  if (!raw) return null;
  const clean = raw.split('T')[0].split(' ')[0];
  const parts = clean.includes('-') ? clean.split('-') : clean.split('/');
  if (parts.length !== 3) return null;
  let [year, month, day] = parts.map((p) => parseInt(p, 10));
  if (parts[0].length <= 2 && parts[2].length === 4) {
    [day, month, year] = parts.map((p) => parseInt(p, 10));
  }
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month - 1, day);
};

export default function GuestListRSVPScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const { selectedEvent, refreshEvents } = useEvent();
  const insets = useSafeAreaInsets();

  // Shared guest list (same data as the door screen)
  const { guests: allGuests, setGuests, isLoading: loading, refreshGuests } = useGuests();
  const guests = useMemo<RSVPGuestItem[]>(
    () => allGuests.map((g) => ({ ...g, rsvp_status: getRsvpStatus(g) })),
    [allGuests]
  );
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterRsvp, setFilterRsvp] = useState<'all' | 'confirmed' | 'pending_rsvp' | 'declined'>('all');

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshEvents();
    await refreshGuests();
    setRefreshing(false);
  };

  // Fecha límite de RSVP: la configurada en el evento (fecha fija o X días antes); si el servidor
  // todavía no la informa, 7 días antes del evento
  const deadlineInfo = useMemo(() => {
    const eventDate = parseDateOnly(selectedEvent?.event_date);
    let deadlineDate = parseDateOnly(selectedEvent?.rsvp_deadline_effective);
    if (!deadlineDate && eventDate) {
      deadlineDate = new Date(eventDate);
      deadlineDate.setDate(deadlineDate.getDate() - (selectedEvent?.rsvp_deadline_days ?? 7));
    }
    if (!deadlineDate) return null;

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    let badgeText = '';
    if (diffDays > 0) {
      badgeText = `⏳ Faltan ${diffDays} día${diffDays === 1 ? '' : 's'} para confirmar lista definitiva de catering`;
    } else if (diffDays === 0) {
      badgeText = `⚠️ ¡Hoy es el último día para confirmar la lista de catering!`;
    } else {
      badgeText = `🔒 El plazo de confirmación previa ha finalizado`;
    }

    return {
      isExpired: diffDays < 0,
      formattedDeadline: deadlineDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
      formattedEventDate: eventDate
        ? eventDate.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
        : null,
      badgeText,
    };
  }, [selectedEvent?.event_date, selectedEvent?.rsvp_deadline_effective, selectedEvent?.rsvp_deadline_days]);

  const [sendingReminderId, setSendingReminderId] = useState<number | string | null>(null);
  const [historyGuest, setHistoryGuest] = useState<RSVPGuestItem | null>(null);

  // Fallback: open the user's own WhatsApp with the reminder written (the answer won't be processed automatically)
  const openManualReminder = (guest: RSVPGuestItem) => {
    const coupleName = selectedEvent?.couple_names || selectedEvent?.title || 'la Boda';
    const deadlineTxt = deadlineInfo ? `antes del ${deadlineInfo.formattedDeadline}` : 'a la brevedad';
    const text = `¡Hola ${guest.name}! 💕 Te recordamos confirmar tu asistencia para ${coupleName} ${deadlineTxt}. ¡Contamos contigo! 🥂`;
    Linking.openURL(`https://wa.me/${toWhatsAppNumber(guest.phone)}?text=${encodeURIComponent(text)}`).catch(() => {
      Alert.alert('WhatsApp no disponible', `Número del invitado: ${guest.phone}`);
    });
  };

  // Sends the reminder through the system's WhatsApp bot: if the guest answers 1 / 2 it's confirmed automatically
  const sendReminderViaBot = async (guest: RSVPGuestItem) => {
    setSendingReminderId(guest.id);
    try {
      const res = await fetch(`${APP_URL}/guests/${guest.id}/reminder`, {
        method: 'POST',
        headers: getAuthHeaders(user, { 'Content-Type': 'application/json' }),
      });
      const json = await res.json().catch(() => null);

      if (res.ok) {
        setGuests((prev) =>
          prev.map((g) =>
            String(g.id) === String(guest.id)
              ? { ...g, reminder_sent_at: json?.guest?.reminder_sent_at ?? new Date().toISOString() }
              : g
          )
        );
        Alert.alert('Recordatorio enviado', json?.message || `El recordatorio a ${guest.name} está en camino.`);
      } else if (res.status === 409 || res.status === 422) {
        Alert.alert('Recordatorio', json?.message || 'No se pudo enviar el recordatorio.');
      } else {
        Alert.alert(
          'No se pudo enviar por el sistema',
          json?.message || 'El WhatsApp del sistema no respondió.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Enviar desde mi WhatsApp', onPress: () => openManualReminder(guest) },
          ]
        );
      }
    } catch {
      Alert.alert('Sin conexión', 'No se pudo contactar al servidor.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Enviar desde mi WhatsApp', onPress: () => openManualReminder(guest) },
      ]);
    } finally {
      setSendingReminderId(null);
    }
  };

  const [resendingQrId, setResendingQrId] = useState<number | string | null>(null);

  // Re-sends the QR entry pass (same one sent automatically on confirmation) through the system's WhatsApp
  const resendQrPass = (guest: RSVPGuestItem) => {
    if (!(guest.phone || '').replace(/[^\d]/g, '')) {
      Alert.alert('Sin teléfono', `El invitado ${guest.name} no tiene un teléfono registrado.`);
      return;
    }
    Alert.alert(
      'Reenviar pase QR',
      `Se le enviará a ${guest.name} su pase QR de ingreso al número ${guest.phone} por el WhatsApp del sistema.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Reenviar',
          onPress: async () => {
            setResendingQrId(guest.id);
            try {
              const res = await fetch(`${APP_URL}/guests/${guest.id}/resend-qr`, {
                method: 'POST',
                headers: getAuthHeaders(user, { 'Content-Type': 'application/json' }),
              });
              const json = await res.json().catch(() => null);
              Alert.alert(
                res.ok ? 'QR enviado' : 'No se pudo reenviar',
                json?.message || (res.ok ? `Se reenvió el QR a ${guest.name}.` : 'Intentá de nuevo en unos minutos.')
              );
            } catch {
              Alert.alert('Sin conexión', 'No se pudo contactar al servidor. Intentá de nuevo cuando tengas señal.');
            } finally {
              setResendingQrId(null);
            }
          },
        },
      ]
    );
  };

  const sendWhatsAppReminder = (guest: RSVPGuestItem) => {
    if (!(guest.phone || '').replace(/[^\d]/g, '')) {
      Alert.alert('Sin teléfono', `El invitado ${guest.name} no tiene un teléfono registrado.`);
      return;
    }
    Alert.alert(
      'Enviar recordatorio',
      `Se le enviará a ${guest.name} un recordatorio por el WhatsApp del sistema. Si responde 1 o 2, su confirmación se registra sola.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desde mi WhatsApp', onPress: () => openManualReminder(guest) },
        { text: 'Enviar', onPress: () => sendReminderViaBot(guest) },
      ]
    );
  };

  // Filtrado de invitados
  const filteredGuests = useMemo(() => {
    return guests.filter((g) => {
      const matchQuery =
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.phone && g.phone.includes(searchQuery)) ||
        companionsMatch(g, searchQuery);

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
      .reduce((acc, g) => acc + getGuestPasses(g), 0);

    const confirmedGuestsList = guests.filter((g) => g.rsvp_status === 'confirmed');
    const lactoseCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('lactosa')).length;
    const celiacCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('tacc') || g.dietary_restrictions?.toLowerCase().includes('celíac')).length;
    const veggieCount = confirmedGuestsList.filter((g) => g.dietary_restrictions?.toLowerCase().includes('vegetar') || g.dietary_restrictions?.toLowerCase().includes('vegan')).length;
    const totalSpecialCount = lactoseCount + celiacCount + veggieCount;
    const standardPasses = Math.max(0, confirmedPasses - totalSpecialCount);

    return { total, confirmed, pending, declined, confirmedPasses, lactoseCount, celiacCount, veggieCount, totalSpecialCount, standardPasses };
  }, [guests]);

  const handleOpenHistory = useCallback((guest: RSVPGuestItem) => {
    setHistoryGuest(guest);
  }, []);

  const handleSendReminder = useCallback((guest: RSVPGuestItem) => {
    sendWhatsAppReminder(guest);
  }, [selectedEvent, deadlineInfo, user]);

  const handleResendQr = useCallback((guest: RSVPGuestItem) => {
    resendQrPass(guest);
  }, [user]);

  const renderGuestItem = useCallback(
    ({ item }: { item: RSVPGuestItem }) => (
      <RsvpGuestCard
        guest={item}
        isDeadlineExpired={Boolean(deadlineInfo?.isExpired)}
        isSendingReminder={sendingReminderId === item.id}
        isResendingQr={resendingQrId === item.id}
        onOpenHistory={handleOpenHistory}
        onSendReminder={handleSendReminder}
        onResendQr={handleResendQr}
        styles={styles}
      />
    ),
    [deadlineInfo?.isExpired, sendingReminderId, resendingQrId, handleOpenHistory, handleSendReminder, handleResendQr]
  );

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
            <View style={styles.headerBadge}>
              <ThemedText style={styles.headerSubtitle} numberOfLines={1}>
                {selectedEvent ? (selectedEvent.couple_names || selectedEvent.title || '').toUpperCase() : 'SIN EVENTO'}
              </ThemedText>
            </View>
            <ThemedText type="subtitle" style={styles.headerTitle}>Invitados y RSVP</ThemedText>
            {selectedEvent?.location ? (
              <View style={styles.headerInfoRow}>
                <Ionicons name="location-outline" size={14} color="#94a3b8" />
                <ThemedText style={styles.headerEventDate} numberOfLines={1}>{selectedEvent.location}</ThemedText>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={handleRefresh}
            disabled={refreshing || loading}
            style={styles.refreshBtn}>
            {refreshing || loading ? (
              <ActivityIndicator size="small" color="#e11d48" />
            ) : (
              <Ionicons name="refresh" size={20} color="#e11d48" />
            )}
          </Pressable>
        </View>

        {!selectedEvent ? (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#e11d48']} />
            }>
            <View style={styles.noEventCard}>
              <Ionicons name="calendar-outline" size={36} color="#c2410c" />
              <ThemedText style={styles.noEventTitle}>Ningún evento seleccionado</ThemedText>
              <ThemedText style={styles.noEventSub}>
                Ingresá a la pestaña “Info Boda” para seleccionar el evento que deseas gestionar.
              </ThemedText>
            </View>
          </ScrollView>
        ) : (
          <FlatList
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            data={loading && guests.length === 0 ? [] : filteredGuests}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderGuestItem}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#e11d48']} />
            }
            ListHeaderComponent={
              <>
                {/* BANNER REGLA 7 DÍAS ANTES DEL EVENTO */}
                <View style={styles.deadlineBanner}>
                  <View style={styles.deadlineIconBox}>
                    <Ionicons name="alarm-outline" size={22} color="#ea580c" />
                  </View>
                  <View style={styles.deadlineCol}>
                    <ThemedText style={styles.deadlineTitle}>
                      Cierre de RSVP
                    </ThemedText>
                    {deadlineInfo ? (
                      <>
                        <ThemedText style={styles.deadlineSub}>
                          Fecha límite: <ThemedText style={{ fontWeight: '800', color: '#9a3412' }}>{deadlineInfo.formattedDeadline}</ThemedText>
                          {deadlineInfo.formattedEventDate ? ` (Boda: ${deadlineInfo.formattedEventDate}).` : '.'}
                        </ThemedText>
                        <View style={[styles.deadlineBadgePill, deadlineInfo.isExpired && styles.deadlineBadgePillExpired]}>
                          <ThemedText style={[styles.deadlineBadge, deadlineInfo.isExpired && styles.deadlineBadgeExpired]}>
                            {deadlineInfo.badgeText}
                          </ThemedText>
                        </View>
                      </>
                    ) : (
                      <ThemedText style={styles.deadlineSub}>
                        {selectedEvent.event_date
                          ? `Fecha del evento: ${selectedEvent.event_date}`
                          : 'Fecha no definida aún en la configuración del evento.'}
                      </ThemedText>
                    )}
                  </View>
                </View>

                {/* KPIs PRE-EVENTO (CONFIRMACIÓN RSVP) */}
                <View style={styles.statsRow}>
                  <LinearGradient
                    colors={['#10b981', '#059669']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.statCard}>
                    <View style={styles.statIconChipLight}>
                      <Ionicons name="checkmark-circle" size={16} color="#ffffff" />
                    </View>
                    <ThemedText style={styles.statNumber}>{rsvpStats.confirmed}</ThemedText>
                    <ThemedText style={styles.statLabel}>Confirmaron</ThemedText>
                    <ThemedText style={styles.statSub}>{rsvpStats.confirmedPasses} personas</ThemedText>
                  </LinearGradient>

                  <View style={styles.statCardSecondary}>
                    <View style={[styles.statIconChip, { backgroundColor: '#fef3c7' }]}>
                      <Ionicons name="time-outline" size={16} color="#d97706" />
                    </View>
                    <ThemedText style={styles.statNumberAmber}>{rsvpStats.pending}</ThemedText>
                    <ThemedText style={styles.statLabelDark}>Pendientes</ThemedText>
                    <ThemedText style={styles.statSubDark}>Sin responder</ThemedText>
                  </View>

                  <View style={styles.statCardSecondary}>
                    <View style={[styles.statIconChip, { backgroundColor: '#ffe4e6' }]}>
                      <Ionicons name="close-circle-outline" size={16} color="#e11d48" />
                    </View>
                    <ThemedText style={styles.statNumberRed}>{rsvpStats.declined}</ThemedText>
                    <ThemedText style={styles.statLabelDark}>No asisten</ThemedText>
                    <ThemedText style={styles.statSubDark}>Declinaron</ThemedText>
                  </View>
                </View>

                {/* DESGLOSE DE CATERING Y MENÚ DEFINITIVO */}
                <View style={styles.cateringCard}>
                  <View style={styles.cateringHeaderRow}>
                    <View style={[styles.statIconChip, { backgroundColor: '#dcfce7' }]}>
                      <Ionicons name="restaurant-outline" size={16} color="#16a34a" />
                    </View>
                    <View style={styles.cateringHeaderCol}>
                      <ThemedText style={styles.cateringCardTitle}>Catering para el proveedor</ThemedText>
                      <ThemedText style={styles.cateringCardSub}>
                        Un solo menú para todos · las restricciones aplican solo al invitado indicado
                      </ThemedText>
                    </View>
                  </View>

                  <View style={styles.cateringPillsRow}>
                    <View style={styles.pillStandard}>
                      <ThemedText style={styles.pillStandardText}>
                        🍽️ {rsvpStats.standardPasses} estándar
                      </ThemedText>
                    </View>

                    {rsvpStats.lactoseCount > 0 && (
                      <View style={styles.pillSpecial}>
                        <ThemedText style={styles.pillSpecialText}>
                          🥛 {rsvpStats.lactoseCount} sin lactosa
                        </ThemedText>
                      </View>
                    )}

                    {rsvpStats.celiacCount > 0 && (
                      <View style={styles.pillSpecial}>
                        <ThemedText style={styles.pillSpecialText}>
                          🌾 {rsvpStats.celiacCount} sin TACC
                        </ThemedText>
                      </View>
                    )}

                    {rsvpStats.veggieCount > 0 && (
                      <View style={styles.pillSpecial}>
                        <ThemedText style={styles.pillSpecialText}>
                          🌱 {rsvpStats.veggieCount} vegetariano
                        </ThemedText>
                      </View>
                    )}
                  </View>
                </View>

                {/* Búsqueda y Filtros RSVP */}
                <View style={styles.searchSection}>
                  <View style={styles.searchInputWrapper}>
                    <Ionicons name="search" size={20} color="#94a3b8" style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Buscar por nombre o teléfono..."
                      placeholderTextColor="#94a3b8"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                    />
                    {searchQuery.length > 0 && (
                      <Pressable onPress={() => setSearchQuery('')} hitSlop={8} style={styles.clearBtn}>
                        <Ionicons name="close-circle" size={19} color="#94a3b8" />
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
                        Confirmaron ({rsvpStats.confirmed})
                      </ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => setFilterRsvp('pending_rsvp')}
                      style={[styles.pill, filterRsvp === 'pending_rsvp' && styles.pillActiveAmber]}>
                      <ThemedText style={[styles.pillText, filterRsvp === 'pending_rsvp' && styles.pillTextActive]}>
                        Pendientes ({rsvpStats.pending})
                      </ThemedText>
                    </Pressable>

                    <Pressable
                      onPress={() => setFilterRsvp('declined')}
                      style={[styles.pill, filterRsvp === 'declined' && styles.pillActiveRed]}>
                      <ThemedText style={[styles.pillText, filterRsvp === 'declined' && styles.pillTextActive]}>
                        No asisten ({rsvpStats.declined})
                      </ThemedText>
                    </Pressable>
                  </ScrollView>
                </View>

                {/* Título de Sección de Invitados */}
                <ThemedText style={[styles.sectionTitle, { marginBottom: 10 }]}>
                  INVITADOS ({filteredGuests.length}) · tocá uno para ver su historial
                </ThemedText>
              </>
            }
            ListEmptyComponent={
              loading && guests.length === 0 ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#e11d48" />
                  <ThemedText style={styles.loadingText}>Cargando lista de invitados desde el servidor...</ThemedText>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={34} color="#94a3b8" />
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
              )
            }
          />
        )}
      </SafeAreaView>

      <GuestHistoryModal guest={historyGuest} onClose={() => setHistoryGuest(null)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerBadge: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
    maxWidth: 260,
  },
  headerInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deadlineBadgePill: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff7ed',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 2,
  },
  deadlineBadgePillExpired: {
    backgroundColor: '#f1f5f9',
  },
  deadlineBadgeExpired: {
    color: '#64748b',
  },
  statIconChip: {
    width: 30,
    height: 30,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statIconChipLight: {
    width: 30,
    height: 30,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  cateringHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  guestStatusBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tablePill: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  tablePillText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#be123c',
  },
  qrResendBtnText: {
    color: '#be123c',
    fontSize: 14,
    fontWeight: '700',
  },
  reminderNote: {
    fontSize: 11,
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f7fb',
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
    backgroundColor: '#f6f7fb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 160,
    gap: 6,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#be123c',
    letterSpacing: 0.6,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerEventDate: {
    flexShrink: 1,
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  refreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  refreshBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e11d48',
  },

  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.three,
  },

  /* Banner Límite 7 días */
  deadlineBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  deadlineIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#ffedd5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deadlineIcon: {
    fontSize: 22,
  },
  deadlineCol: {
    flex: 1,
    gap: 4,
  },
  deadlineTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  deadlineSub: {
    fontSize: 13,
    color: '#64748b',
  },
  deadlineBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#c2410c',
  },

  /* KPIs Pre-Evento */
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    gap: 2,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  statNumber: {
    color: '#ffffff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    marginTop: 6,
  },
  statLabel: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  statSub: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 12,
    fontWeight: '500',
  },
  statCardSecondary: {
    flex: 1,
    padding: 14,
    borderRadius: 20,
    gap: 2,
    backgroundColor: '#ffffff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statNumberAmber: {
    color: '#d97706',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    marginTop: 6,
  },
  statNumberRed: {
    color: '#e11d48',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    marginTop: 6,
  },
  statLabelDark: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  cateringCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.four,
    gap: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cateringHeaderCol: {
    flex: 1,
    gap: 2,
  },
  cateringCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  cateringCardSub: {
    fontSize: 12,
    lineHeight: 17,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillStandardText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  pillSpecial: {
    backgroundColor: '#fff7ed',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillSpecialText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#c2410c',
  },
  statSubDark: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '500',
  },

  /* Búsqueda */
  searchSection: {
    gap: 12,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    height: 52,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    fontSize: 16,
    color: '#0f172a',
    fontWeight: '500',
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
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
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
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  pillTextActive: {
    color: '#ffffff',
  },

  /* Lista de Invitados */
  guestListSection: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1,
    marginTop: Spacing.one,
  },
  guestCard: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingVertical: 16,
    paddingLeft: 20,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  guestInfoCol: {
    flex: 1,
    gap: 6,
  },
  guestNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  guestName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  badgeConfirmed: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeConfirmedText: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  badgePending: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgePendingText: {
    color: '#b45309',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  badgeDeclined: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeDeclinedText: {
    color: '#be123c',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  detailText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  detailSubtle: {
    fontSize: 13,
    color: '#94a3b8',
  },
  dietBox: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  dietText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400e',
  },
  notesText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  reminderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 112,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  qrResendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 112,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  reminderBtnText: {
    color: '#15803d',
    fontSize: 14,
    fontWeight: '700',
  },
  /* Empty & Loading States */
  loadingContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
    textAlign: 'center',
  },
  emptyContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e293b',
    textAlign: 'center',
    marginTop: 4,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 19,
  },
  noEventCard: {
    backgroundColor: '#fff7ed',
    borderRadius: 20,
    padding: Spacing.four * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  noEventIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  noEventTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#9a3412',
    textAlign: 'center',
    marginTop: 4,
  },
  noEventSub: {
    fontSize: 13,
    color: '#c2410c',
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
});
