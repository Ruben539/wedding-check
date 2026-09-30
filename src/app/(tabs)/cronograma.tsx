import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  ScrollView,
  Pressable,
  Alert,
  Linking,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { APP_URL, SKIP_EVENT_DATE_CHECK } from '@/env';
import { useAuth, getAuthHeaders } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface TimelineItem {
  id: string;
  time: string; // HH:MM o rango ej. "20:00 - 21:00"
  title: string;
  description?: string;
  completed?: boolean;
}

export default function TimelineScreen() {
  const { user } = useAuth();
  const { selectedEvent, selectedEventId, refreshEvents } = useEvent();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'idle'>('idle');

  const storageKey = `@wedding_check_timing_${selectedEventId || 'default'}`;

  const isDateToday = (dateStr?: string | null): boolean => {
    if (!dateStr) return false;
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const currentDay = now.getDate();

      const isoPart = dateStr.split('T')[0].split(' ')[0];
      if (isoPart.includes('-')) {
        const parts = isoPart.split('-').map((p) => parseInt(p, 10));
        if (parts.length === 3) {
          return parts[0] === currentYear && parts[1] === currentMonth && parts[2] === currentDay;
        }
      }
      if (isoPart.includes('/')) {
        const parts = isoPart.split('/').map((p) => parseInt(p, 10));
        if (parts.length === 3) {
          return parts[2] === currentYear && parts[1] === currentMonth && parts[0] === currentDay;
        }
      }
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        return (
          parsed.getFullYear() === currentYear &&
          parsed.getMonth() + 1 === currentMonth &&
          parsed.getDate() === currentDay
        );
      }
    } catch {
      return false;
    }
    return false;
  };

  const isEventToday = useMemo(() => {
    if (SKIP_EVENT_DATE_CHECK) return true;
    return isDateToday(selectedEvent?.event_date);
  }, [selectedEvent?.event_date]);

  const formattedEventDate = useMemo(() => {
    if (!selectedEvent?.event_date) return null;
    try {
      const raw = selectedEvent.event_date.split('T')[0].split(' ')[0];
      const parts = raw.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);
        const d = new Date(year, month, day);
        return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
      return selectedEvent.event_date;
    } catch {
      return selectedEvent.event_date;
    }
  }, [selectedEvent?.event_date]);

  // Actualizar reloj en tiempo real cada 30 segundos
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTimeStr(
        `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  // Función para normalizar items que vienen del backend
  const normalizeItems = useCallback((items: any[]): TimelineItem[] => {
    if (!Array.isArray(items)) return [];
    return items.map((it, idx) => ({
      id: String(it.id || `timing_${idx}`),
      time: String(it.time || '').trim(),
      title: String(it.title || '').trim(),
      description: it.description ? String(it.description).trim() : '',
      completed: Boolean(it.completed),
    }));
  }, []);

  // Cargar cronograma directamente desde el backend para el evento activo
  const fetchTimingFromBackend = useCallback(async (silent = false) => {
    if (!selectedEventId) {
      setTimeline([]);
      if (!silent) setIsRefreshing(false);
      return;
    }

    if (!silent) setIsRefreshing(true);
    setSyncStatus('syncing');

    try {
      const res = await fetch(`${APP_URL}/events/${selectedEventId}/timing`, {
        method: 'GET',
        headers: getAuthHeaders(user),
      });

      if (res.ok) {
        const json = await res.json();
        const serverItems = normalizeItems(json.timing || []);
        setTimeline(serverItems);

        // Guardar copia local en caché para soporte offline
        await AsyncStorage.setItem(storageKey, JSON.stringify(serverItems));
        setSyncStatus('synced');
      } else {
        // En caso de falla de red, intentar leer caché offline
        const localSaved = await AsyncStorage.getItem(storageKey);
        if (localSaved) {
          setTimeline(normalizeItems(JSON.parse(localSaved)));
        } else if (selectedEvent?.timing && Array.isArray(selectedEvent.timing)) {
          setTimeline(normalizeItems(selectedEvent.timing));
        } else {
          setTimeline([]);
        }
        setSyncStatus('offline');
      }
    } catch {
      // Offline fallback
      try {
        const localSaved = await AsyncStorage.getItem(storageKey);
        if (localSaved) {
          setTimeline(normalizeItems(JSON.parse(localSaved)));
        } else if (selectedEvent?.timing && Array.isArray(selectedEvent.timing)) {
          setTimeline(normalizeItems(selectedEvent.timing));
        } else {
          setTimeline([]);
        }
      } catch {
        setTimeline([]);
      }
      setSyncStatus('offline');
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, [selectedEventId, selectedEvent, user, storageKey, normalizeItems]);

  // Actualizar todo (eventos y cronograma del evento seleccionado)
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setSyncStatus('syncing');
    try {
      await refreshEvents();
      await fetchTimingFromBackend(false);
    } catch {
      setSyncStatus('offline');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Al cambiar de evento o abrir la pantalla, cargar desde backend
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      // 1. Mostrar de inmediato si ya vino en el objeto del evento
      if (selectedEvent?.timing && Array.isArray(selectedEvent.timing) && selectedEvent.timing.length > 0) {
        if (isMounted) setTimeline(normalizeItems(selectedEvent.timing));
      } else {
        // 2. Si no, chequear caché local para evitar pantalla en blanco
        try {
          const cached = await AsyncStorage.getItem(storageKey);
          if (cached && isMounted) {
            setTimeline(normalizeItems(JSON.parse(cached)));
          }
        } catch {
          // ignore
        }
      }

      // 3. Consultar siempre al backend para tener la versión más fresca
      if (isMounted) {
        fetchTimingFromBackend(true);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [selectedEventId, selectedEvent, fetchTimingFromBackend, normalizeItems, storageKey]);

  // Alternar estado completado de un hito en el backend en tiempo real
  const toggleMilestone = async (id: string) => {
    if (!isEventToday) {
      Alert.alert(
        'Modo Solo Lectura',
        `El cronograma solo puede marcarse como cumplido el día del evento (${formattedEventDate || 'fecha programada'}).\n\nActualmente te encuentras en modo de consulta.`,
        [{ text: 'Entendido' }]
      );
      return;
    }

    // Actualización optimista inmediata en la UI
    const updated = timeline.map((item) =>
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    setTimeline(updated);

    try {
      await AsyncStorage.setItem(storageKey, JSON.stringify(updated));
    } catch {
      // ignore
    }

    if (!selectedEventId) return;

    try {
      const res = await fetch(`${APP_URL}/events/${selectedEventId}/timing/items/${id}/toggle`, {
        method: 'POST',
        headers: getAuthHeaders(user),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.timing) {
          setTimeline(normalizeItems(json.timing));
        }
        setSyncStatus('synced');
      }
    } catch {
      setSyncStatus('offline');
    }
  };

  // Compartir estado del cronograma por WhatsApp
  const handleShareTimeline = () => {
    if (timeline.length === 0) {
      Alert.alert('Sin datos', 'No hay momentos en el cronograma para compartir.');
      return;
    }

    const weddingTitle = selectedEvent?.couple_names || selectedEvent?.title || 'Boda';
    const lines = timeline
      .map((item) => {
        const check = item.completed ? '✅' : '⏳';
        const desc = item.description ? `\n   ↳ _${item.description}_` : '';
        return `${check} *${item.time}* - ${item.title}${desc}`;
      })
      .join('\n\n');

    const msg = `⏱️ *TIMELINE - ${weddingTitle.toUpperCase()}*\n📅 Cronograma oficial de coordinación\n━━━━━━━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━━━━━━━\n✨ _Wedding Check - Timeline en Vivo_`;

    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`).catch(() => {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp.');
    });
  };

  // Próximo hito pendiente
  const nextMilestone = useMemo(() => {
    return timeline.find((item) => !item.completed) || null;
  }, [timeline]);

  // Total completados
  const completedCount = useMemo(() => {
    return timeline.filter((item) => item.completed).length;
  }, [timeline]);

  const progressPercent = timeline.length > 0 ? Math.round((completedCount / timeline.length) * 100) : 0;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        
        {/* Header Superior */}
        <View style={styles.headerBar}>
          <View style={styles.headerTitleCol}>
            <View style={styles.eventBadgeRow}>
              <View style={styles.eventBadge}>
                <ThemedText style={styles.eventBadgeText}>
                  💍 {selectedEvent ? (selectedEvent.couple_names || selectedEvent.title).toUpperCase() : 'BODA'}
                </ThemedText>
              </View>

              {!isEventToday && (
                <View style={styles.readOnlyHeaderBadge}>
                  <ThemedText style={styles.readOnlyHeaderBadgeText}>
                    🔒 MODO CONSULTA
                  </ThemedText>
                </View>
              )}

              {/* Indicador de Estado de Conexión con el Back */}
              <View style={styles.syncBadge}>
                {syncStatus === 'syncing' || isRefreshing ? (
                  <View style={styles.syncingRow}>
                    <ActivityIndicator size={10} color="#e11d48" />
                    <ThemedText style={styles.syncText}>Sincronizando...</ThemedText>
                  </View>
                ) : syncStatus === 'synced' ? (
                  <ThemedText style={styles.syncTextSuccess}>☁️ Conectado</ThemedText>
                ) : syncStatus === 'offline' ? (
                  <ThemedText style={styles.syncTextOffline}>📱 Modo local</ThemedText>
                ) : null}
              </View>
            </View>

            <ThemedText type="subtitle" style={styles.headerTitle}>
              Timeline
            </ThemedText>
            <ThemedText style={styles.clockText}>
              🕐 Hora actual: <ThemedText style={{ fontWeight: '900', color: '#e11d48' }}>{currentTimeStr || '19:30'} hs</ThemedText>
            </ThemedText>
          </View>

          {/* Botones de Acción Superior */}
          <View style={styles.headerButtonsRow}>
            {timeline.length > 0 && (
              <Pressable onPress={handleShareTimeline} style={styles.shareBtn}>
                <Ionicons name="logo-whatsapp" size={16} color="#ffffff" />
                <ThemedText style={styles.shareBtnText}>Compartir</ThemedText>
              </Pressable>
            )}
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={['#e11d48']}
              tintColor="#e11d48"
            />
          }>

          {/* Banner Informativo de Modo Solo Lectura si no es la fecha del evento */}
          {!isEventToday && (
            <View style={styles.readOnlyNoticeBox}>
              <Ionicons name="information-circle" size={22} color="#b45309" />
              <View style={styles.readOnlyNoticeContent}>
                <ThemedText style={styles.readOnlyNoticeTitle}>
                  Modo de Solo Lectura (Consulta)
                </ThemedText>
                <ThemedText style={styles.readOnlyNoticeDesc}>
                  Este evento está programado para el{' '}
                  <ThemedText style={styles.readOnlyNoticeDate}>
                    {formattedEventDate || selectedEvent?.event_date || 'otra fecha'}
                  </ThemedText>
                  . El seguimiento y marcado de hitos cumplidos en tiempo real se habilitarán el día del evento.
                </ThemedText>
              </View>
            </View>
          )}

          {/* Ficha Informativa del Evento desde el Backend */}
          {selectedEvent && (
            <View style={styles.eventInfoCard}>
              <View style={styles.eventInfoMainRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <ThemedText style={styles.eventCoupleName}>
                    {selectedEvent.couple_names || selectedEvent.title}
                  </ThemedText>
                  {selectedEvent.location ? (
                    <View style={styles.infoRow}>
                      <Ionicons name="location-outline" size={13} color="#64748b" />
                      <ThemedText style={styles.infoText}>{selectedEvent.location}</ThemedText>
                    </View>
                  ) : null}
                  {formattedEventDate ? (
                    <View style={styles.infoRow}>
                      <Ionicons name="calendar-outline" size={13} color="#64748b" />
                      <ThemedText style={styles.infoText}>{formattedEventDate}</ThemedText>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>
          )}

          {/* Tarjeta de Próximo Momento & Progreso en Vivo */}
          {timeline.length > 0 && (
            <LinearGradient
              colors={['#FF0055', '#E61E50', '#F97316']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroIconBox}>
                  <ThemedText style={styles.heroIconText}>⏱️</ThemedText>
                </View>
                <View style={styles.heroCol}>
                  <ThemedText style={styles.heroSubtitle}>PRÓXIMO HITO A COORDINAR</ThemedText>
                  <ThemedText style={styles.heroTitle} numberOfLines={2}>
                    {nextMilestone ? `${nextMilestone.time} · ${nextMilestone.title}` : '🎉 ¡Todos los hitos completados!'}
                  </ThemedText>
                </View>
              </View>

              {/* Barra de Progreso del Cronograma */}
              <View style={styles.progressContainer}>
                <View style={styles.progressLabelRow}>
                  <ThemedText style={styles.progressText}>
                    {completedCount} de {timeline.length} momentos cumplidos
                  </ThemedText>
                  <ThemedText style={styles.progressPercent}>{progressPercent}%</ThemedText>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
                </View>
              </View>
            </LinearGradient>
          )}

          {/* Estado Vacío: Cuando el backend no tiene cronograma cargado para este evento */}
          {timeline.length === 0 && (
            <View style={styles.emptyStateCard}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="calendar-outline" size={38} color="#94a3b8" />
              </View>
              <ThemedText style={styles.emptyTitle}>Sin Cronograma en el Sistema</ThemedText>
              <ThemedText style={styles.emptySub}>
                Este evento aún no tiene un cronograma (timing) registrado en el panel administrativo del backend.
              </ThemedText>
              <ThemedText style={styles.emptyHint}>
                Una vez cargado el timing en el sistema web, aparecerá automáticamente aquí para coordinar la boda en vivo.
              </ThemedText>

              <Pressable
                disabled={isRefreshing}
                onPress={handleRefresh}
                style={styles.emptyRefreshBtn}>
                {isRefreshing ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <ActivityIndicator size="small" color="#e11d48" />
                    <ThemedText style={styles.emptyRefreshBtnText}>Actualizando...</ThemedText>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="refresh" size={16} color="#e11d48" />
                    <ThemedText style={styles.emptyRefreshBtnText}>Actualizar timeline</ThemedText>
                  </View>
                )}
              </Pressable>
            </View>
          )}

          {/* Timeline Vertical de Momentos listados desde el Backend */}
          {timeline.length > 0 && (
            <View style={styles.timelineSection}>
              <View style={styles.timelineHeaderRow}>
                <ThemedText style={styles.sectionTitle}>
                  HITOS PROGRAMADOS ({timeline.length})
                </ThemedText>
                <ThemedText style={styles.sectionSub}>
                  {isEventToday ? 'Toca para marcar cumplido' : 'Solo lectura · Día del evento'}
                </ThemedText>
              </View>

              {timeline.map((item, index) => {
                const isPast = currentTimeStr && item.time < currentTimeStr && !item.completed;
                const isNext = nextMilestone?.id === item.id;

                return (
                  <View key={item.id} style={styles.timelineRow}>
                    {/* Columna Izquierda: Hora & Línea */}
                    <View style={styles.timeCol}>
                      <ThemedText style={[styles.timeText, item.completed && styles.timeTextCompleted]}>
                        {item.time}
                      </ThemedText>
                      <View style={styles.lineTrack}>
                        <Pressable
                          onPress={() => toggleMilestone(item.id)}
                          style={[
                            styles.statusDot,
                            item.completed
                              ? styles.statusDotCompleted
                              : isNext
                              ? styles.statusDotNext
                              : isPast
                              ? styles.statusDotPast
                              : styles.statusDotPending,
                          ]}>
                          <Ionicons
                            name={item.completed ? 'checkmark' : isNext ? 'play' : 'time-outline'}
                            size={14}
                            color={item.completed || isNext ? '#ffffff' : '#64748b'}
                          />
                        </Pressable>
                        {index < timeline.length - 1 && <View style={styles.verticalConnector} />}
                      </View>
                    </View>

                    {/* Columna Derecha: Tarjeta del Hito */}
                    <Pressable
                      onPress={() => toggleMilestone(item.id)}
                      style={[
                        styles.milestoneCard,
                        item.completed && styles.milestoneCardCompleted,
                        isNext && styles.milestoneCardNext,
                      ]}>
                      <View style={styles.cardHeaderRow}>
                        <View style={{ flex: 1 }}>
                          <ThemedText
                            style={[
                              styles.milestoneTitle,
                              item.completed && styles.milestoneTitleCompleted,
                            ]}>
                            {item.title}
                          </ThemedText>
                        </View>

                        {item.completed ? (
                          <View style={styles.doneBadge}>
                            <ThemedText style={styles.doneBadgeText}>✅ CUMPLIDO</ThemedText>
                          </View>
                        ) : isNext ? (
                          <View style={styles.nextBadge}>
                            <ThemedText style={styles.nextBadgeText}>🔥 EN CURSO</ThemedText>
                          </View>
                        ) : isPast ? (
                          <View style={styles.pastBadge}>
                            <ThemedText style={styles.pastBadgeText}>⚠️ ATRASADO</ThemedText>
                          </View>
                        ) : null}
                      </View>

                      {/* Descripción / Notas del hito desde el backend */}
                      {item.description ? (
                        <ThemedText
                          style={[
                            styles.milestoneNotes,
                            item.completed && styles.milestoneNotesCompleted,
                          ]}>
                          {item.description}
                        </ThemedText>
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>
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
    gap: 12,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 160,
    gap: 3,
  },
  eventBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventBadge: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  eventBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#e11d48',
    letterSpacing: 0.8,
  },
  readOnlyHeaderBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  readOnlyHeaderBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.8,
  },
  readOnlyNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 10,
  },
  readOnlyNoticeContent: {
    flex: 1,
    gap: 2,
  },
  readOnlyNoticeTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#92400e',
  },
  readOnlyNoticeDesc: {
    fontSize: 12,
    color: '#78350f',
    lineHeight: 16,
  },
  readOnlyNoticeDate: {
    fontWeight: '800',
    color: '#92400e',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  syncText: {
    fontSize: 10,
    color: '#e11d48',
    fontWeight: '700',
  },
  syncTextSuccess: {
    fontSize: 10,
    color: '#10b981',
    fontWeight: '800',
  },
  syncTextOffline: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#0f172a',
  },
  clockText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    backgroundColor: '#10b981',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  shareBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    gap: Spacing.four,
  },

  /* Card Ficha Informativa del Evento */
  eventInfoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  eventInfoMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eventCoupleName: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 4,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  infoText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },

  /* Hero Card */
  heroCard: {
    borderRadius: 20,
    padding: Spacing.four,
    gap: 16,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroIconText: {
    fontSize: 24,
  },
  heroCol: {
    flex: 1,
    gap: 2,
  },
  heroSubtitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#ffe4e6',
    letterSpacing: 1,
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#ffffff',
  },
  progressContainer: {
    gap: 6,
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 4,
  },

  /* Estado Vacío */
  emptyStateCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.five,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 20,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#0f172a',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 380,
  },
  emptyHint: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 16,
    maxWidth: 340,
    marginTop: 2,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#fff1f2',
    borderWidth: 1,
    borderColor: '#fecdd3',
    marginTop: 8,
  },
  emptyRefreshBtnText: {
    color: '#e11d48',
    fontWeight: '800',
    fontSize: 13,
  },

  /* Timeline Section */
  timelineSection: {
    gap: 14,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 1,
  },
  sectionSub: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeCol: {
    width: 55,
    alignItems: 'center',
  },
  timeText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#0f172a',
    marginBottom: 6,
  },
  timeTextCompleted: {
    color: '#94a3b8',
    textDecorationLine: 'line-through',
  },
  lineTrack: {
    flex: 1,
    alignItems: 'center',
    position: 'relative',
  },
  statusDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    borderWidth: 2,
  },
  statusDotCompleted: {
    backgroundColor: '#10b981',
    borderColor: '#059669',
  },
  statusDotNext: {
    backgroundColor: '#e11d48',
    borderColor: '#be123c',
  },
  statusDotPast: {
    backgroundColor: '#f59e0b',
    borderColor: '#d97706',
  },
  statusDotPending: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
  },
  verticalConnector: {
    position: 'absolute',
    top: 28,
    bottom: -10,
    width: 2,
    backgroundColor: '#e2e8f0',
  },
  milestoneCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: Spacing.three,
    gap: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  milestoneCardCompleted: {
    backgroundColor: '#f8fafc',
    opacity: 0.75,
    borderColor: '#f1f5f9',
  },
  milestoneCardNext: {
    borderColor: '#e11d48',
    borderWidth: 1.5,
    backgroundColor: '#fff1f2',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  milestoneTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  milestoneTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#64748b',
  },
  doneBadge: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  doneBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#16a34a',
  },
  nextBadge: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  nextBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#e11d48',
  },
  pastBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  pastBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#d97706',
  },
  milestoneNotes: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 17,
  },
  milestoneNotesCompleted: {
    color: '#94a3b8',
  },
});
