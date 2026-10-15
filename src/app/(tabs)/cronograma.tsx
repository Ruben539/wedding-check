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
                <ThemedText style={styles.eventBadgeText} numberOfLines={1}>
                  {selectedEvent ? (selectedEvent.couple_names || selectedEvent.title).toUpperCase() : 'BODA'}
                </ThemedText>
              </View>

              {!isEventToday && (
                <View style={styles.readOnlyHeaderBadge}>
                  <Ionicons name="lock-closed" size={11} color="#b45309" />
                  <ThemedText style={styles.readOnlyHeaderBadgeText}>MODO CONSULTA</ThemedText>
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
                  <View style={styles.syncingRow}>
                    <View style={[styles.syncDot, { backgroundColor: '#10b981' }]} />
                    <ThemedText style={styles.syncTextSuccess}>Conectado</ThemedText>
                  </View>
                ) : syncStatus === 'offline' ? (
                  <View style={styles.syncingRow}>
                    <View style={[styles.syncDot, { backgroundColor: '#94a3b8' }]} />
                    <ThemedText style={styles.syncTextOffline}>Sin conexión · datos guardados</ThemedText>
                  </View>
                ) : null}
              </View>
            </View>

            <ThemedText type="subtitle" style={styles.headerTitle}>
              Timeline
            </ThemedText>
            <View style={styles.clockRow}>
              <Ionicons name="time-outline" size={15} color="#64748b" />
              <ThemedText style={styles.clockText}>
                Hora actual <ThemedText style={styles.clockValue}>{currentTimeStr || '--:--'} hs</ThemedText>
              </ThemedText>
            </View>
          </View>

          {/* Botones de Acción Superior */}
          <View style={styles.headerButtonsRow}>
            {timeline.length > 0 && (
              <Pressable onPress={handleShareTimeline} style={styles.shareBtn}>
                <Ionicons name="logo-whatsapp" size={18} color="#16a34a" />
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
              colors={['#e11d48', '#f43f5e', '#fb923c']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroCard}>
              <View style={styles.heroRow}>
                <View style={styles.heroIconBox}>
                  <Ionicons name={nextMilestone ? 'play' : 'checkmark-done'} size={26} color="#ffffff" />
                </View>
                <View style={styles.heroCol}>
                  <ThemedText style={styles.heroSubtitle}>{nextMilestone ? 'Próximo momento' : 'Cronograma'}</ThemedText>
                  <ThemedText style={styles.heroTitle} numberOfLines={2}>
                    {nextMilestone ? nextMilestone.title : '¡Todos los momentos cumplidos!'}
                  </ThemedText>
                  {nextMilestone ? (
                    <ThemedText style={styles.heroTime}>{nextMilestone.time} hs</ThemedText>
                  ) : null}
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
                  MOMENTOS ({timeline.length})
                </ThemedText>
                <ThemedText style={styles.sectionSub}>
                  {isEventToday ? 'Tocá para marcar como cumplido' : 'Se marca el día del evento'}
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
                      <View
                        style={[
                          styles.milestoneAccent,
                          item.completed
                            ? { backgroundColor: '#10b981' }
                            : isNext
                            ? { backgroundColor: '#e11d48' }
                            : isPast
                            ? { backgroundColor: '#f59e0b' }
                            : null,
                        ]}
                      />
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
                            <ThemedText style={styles.doneBadgeText}>CUMPLIDO</ThemedText>
                          </View>
                        ) : isNext ? (
                          <View style={styles.nextBadge}>
                            <ThemedText style={styles.nextBadgeText}>EN CURSO</ThemedText>
                          </View>
                        ) : isPast ? (
                          <View style={styles.pastBadge}>
                            <ThemedText style={styles.pastBadgeText}>ATRASADO</ThemedText>
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
  syncDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  clockValue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#e11d48',
  },
  heroTime: {
    fontSize: 14,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 2,
  },
  milestoneAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#e2e8f0',
  },
  container: {
    flex: 1,
    backgroundColor: '#f6f7fb',
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
    gap: 12,
  },
  headerTitleCol: {
    flex: 1,
    minWidth: 160,
    gap: 6,
  },
  eventBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  eventBadge: {
    backgroundColor: '#ffe4e6',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
    maxWidth: 220,
  },
  eventBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#be123c',
    letterSpacing: 0.6,
  },
  readOnlyHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  readOnlyHeaderBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.6,
  },
  readOnlyNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  readOnlyNoticeContent: {
    flex: 1,
    gap: 2,
  },
  readOnlyNoticeTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#92400e',
  },
  readOnlyNoticeDesc: {
    fontSize: 13,
    color: '#78350f',
    lineHeight: 18,
  },
  readOnlyNoticeDate: {
    fontWeight: '800',
    color: '#92400e',
  },
  syncBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  syncingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  syncText: {
    fontSize: 11,
    color: '#e11d48',
    fontWeight: '700',
  },
  syncTextSuccess: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '700',
  },
  syncTextOffline: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#0f172a',
  },
  clockText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  headerButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  shareBtnText: {
    color: '#15803d',
    fontSize: 14,
    fontWeight: '700',
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

  /* Card Ficha Informativa del Evento */
  eventInfoCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: Spacing.four,
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  eventInfoMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  eventCoupleName: {
    fontSize: 18,
    fontWeight: '800',
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
    flexShrink: 1,
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },

  /* Hero Card */
  heroCard: {
    borderRadius: 22,
    padding: Spacing.four,
    gap: 18,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 6,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
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
    fontSize: 12,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.85)',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 19,
    lineHeight: 24,
    fontWeight: '800',
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
    fontSize: 13,
    fontWeight: '600',
    color: '#ffffff',
  },
  progressPercent: {
    fontSize: 15,
    fontWeight: '800',
    color: '#ffffff',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 999,
  },

  /* Estado Vacío */
  emptyStateCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: Spacing.five,
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
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
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 380,
  },
  emptyHint: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 340,
    marginTop: 2,
  },
  emptyRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: '#e11d48',
    marginTop: 8,
  },
  emptyRefreshBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },

  /* Timeline Section */
  timelineSection: {
    gap: 12,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.one,
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 1,
  },
  sectionSub: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
  },
  timelineRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timeCol: {
    width: 56,
    alignItems: 'center',
  },
  timeText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 8,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
    borderWidth: 3,
    borderColor: '#f6f7fb',
  },
  statusDotCompleted: {
    backgroundColor: '#10b981',
  },
  statusDotNext: {
    backgroundColor: '#e11d48',
  },
  statusDotPast: {
    backgroundColor: '#fef3c7',
  },
  statusDotPending: {
    backgroundColor: '#e9ecf2',
  },
  verticalConnector: {
    position: 'absolute',
    top: 30,
    bottom: -12,
    width: 2,
    backgroundColor: '#e2e8f0',
  },
  milestoneCard: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 14,
    gap: 6,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  milestoneCardCompleted: {
    backgroundColor: '#fbfcfd',
    opacity: 0.8,
  },
  milestoneCardNext: {
    backgroundColor: '#fff5f6',
    shadowColor: '#e11d48',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  milestoneTitle: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
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
    borderRadius: 999,
  },
  doneBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.3,
  },
  nextBadge: {
    backgroundColor: '#e11d48',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  nextBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: 0.3,
  },
  pastBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pastBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
    letterSpacing: 0.3,
  },
  milestoneNotes: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 19,
  },
  milestoneNotesCompleted: {
    color: '#94a3b8',
  },
});
