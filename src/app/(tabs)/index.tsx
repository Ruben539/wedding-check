import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getAuthHeaders, useAuth } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { fetchWithTimeout, useSync } from '@/context/sync-context';
import { APP_URL, SKIP_EVENT_DATE_CHECK } from '@/env';
import { useTheme } from '@/hooks/use-theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Network from 'expo-network';

interface GuestItem {
  id: number | string;
  name: string;
  phone: string;
  passes: number;
  confirmed_passes?: number;
  adults?: number;
  youth?: number;
  children?: number;
  table_number?: string | null;
  status: 'pending' | 'confirmed' | 'attended' | 'declined';
  rsvp_status?: string;
  will_attend?: boolean;
  dietary_restrictions?: string | null;
  notes?: string | null;
  qr_code?: string;
  attended_at?: string | null;
  is_vip?: boolean;
  vip_label?: string;
}

// Vibración al escanear: se usa el vibrador del teléfono porque el Taptic Engine de iOS
// se desactiva mientras la cámara está activa
const vibrateScan = (type: 'success' | 'warning' | 'error') => {
  if (type === 'success') {
    Vibration.vibrate(Platform.OS === 'ios' ? undefined : 200);
  } else {
    // Doble vibración para advertencias y errores
    Vibration.vibrate(Platform.OS === 'ios' ? [0, 250] : [0, 150, 120, 150]);
  }
};

export default function DoorReceptionScreen() {
  const { user, logout, isLoading: authLoading } = useAuth();
  const { events, selectedEvent, selectedEventId, setSelectedEventId, refreshEvents } = useEvent();
  const { pendingOps, isSyncing, syncVersion, sendOrQueue, flush, applyPendingOps } = useSync();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const currentEvent = selectedEvent || events.find((e) => e.id === selectedEventId) || events[0];

  const isEventToday = useMemo(() => {
    if (SKIP_EVENT_DATE_CHECK) return true;
    if (!currentEvent?.event_date) return false;
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const currentDay = now.getDate();

      const isoPart = currentEvent.event_date.split('T')[0].split(' ')[0];
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
      const parsed = new Date(currentEvent.event_date);
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
  }, [currentEvent?.event_date]);

  const formattedEventDate = useMemo(() => {
    if (!currentEvent?.event_date) return '';
    const dateStr = currentEvent.event_date;
    const isoPart = dateStr.split('T')[0].split(' ')[0];
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    if (isoPart.includes('-')) {
      const parts = isoPart.split('-').map((p) => parseInt(p, 10));
      if (parts.length === 3) {
        return `${parts[2]} de ${months[parts[1] - 1] || parts[1]} de ${parts[0]}`;
      }
    }
    if (isoPart.includes('/')) {
      const parts = isoPart.split('/').map((p) => parseInt(p, 10));
      if (parts.length === 3) {
        return `${parts[0]} de ${months[parts[1] - 1] || parts[1]} de ${parts[2]}`;
      }
    }
    return dateStr;
  }, [currentEvent?.event_date]);

  const [guests, setGuests] = useState<GuestItem[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Modo de vista: 'list' (Lista de Acreditación) vs 'tables' (Plano por Mesas)
  const [viewMode, setViewMode] = useState<'list' | 'tables'>('list');

  // Modales
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState<boolean>(false);
  // Bloqueo inmediato para evitar lecturas duplicadas del mismo QR antes de que React re-renderice
  const scanLockRef = useRef<boolean>(false);
  const [scannerVisible, setScannerVisible] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [qrInput, setQrInput] = useState<string>('');
  const [scanResult, setScanResult] = useState<{ guest: GuestItem; timestamp: string } | null>(null);
  const [alreadyUsedResult, setAlreadyUsedResult] = useState<{ guest: GuestItem; timestamp?: string } | null>(null);
  const [confirmToggleGuest, setConfirmToggleGuest] = useState<GuestItem | null>(null);
  const [ticketModalGuest, setTicketModalGuest] = useState<GuestItem | null>(null);

  // Alta Express en Puerta
  const [expressModalVisible, setExpressModalVisible] = useState<boolean>(false);
  const [expressName, setExpressName] = useState<string>('');
  const [expressPasses, setExpressPasses] = useState<number>(1);
  const [expressTable, setExpressTable] = useState<string>('');
  const [expressDiet, setExpressDiet] = useState<string>('');
  const [expressAutoCheckIn, setExpressAutoCheckIn] = useState<boolean>(true);
  const [savingExpress, setSavingExpress] = useState<boolean>(false);

  // Reasignación Rápida de Mesa
  const [reassignGuest, setReassignGuest] = useState<GuestItem | null>(null);
  const [newTableInput, setNewTableInput] = useState<string>('');
  const [savingTable, setSavingTable] = useState<boolean>(false);

  // Filtros y Búsqueda de Recepción en Puerta
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'attended' | 'pending'>('all');
  const [updatingGuestId, setUpdatingGuestId] = useState<number | string | null>(null);

  useEffect(() => {
    if (user && selectedEventId) {
      fetchGuestsForEvent(selectedEventId);
    }
  }, [user, selectedEventId, syncVersion]);

  // Vibrar según el resultado del escaneo
  useEffect(() => {
    if (scanResult) vibrateScan('success');
  }, [scanResult]);

  useEffect(() => {
    if (alreadyUsedResult) vibrateScan('warning');
  }, [alreadyUsedResult]);

  // Liberar el bloqueo del escáner cuando se habilita la siguiente lectura
  useEffect(() => {
    if (!scanned) scanLockRef.current = false;
  }, [scanned]);

  const pendingCountForEvent = useMemo(
    () => pendingOps.filter((op) => op.eventId === selectedEventId).length,
    [pendingOps, selectedEventId]
  );

  const formatDisplayTime = (rawTime?: string | null): string => {
    if (!rawTime) {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    // Si ya viene en formato corto HH:MM
    if (/^\d{2}:\d{2}$/.test(rawTime)) {
      return rawTime;
    }
    // Si viene con segundos HH:MM:SS
    if (/^\d{2}:\d{2}:\d{2}$/.test(rawTime)) {
      return rawTime.substring(0, 5);
    }
    // Si viene en formato ISO o SQL datetime "2026-09-27T15:37:00..." o "2026-09-27 15:37:00"
    try {
      const isIso = rawTime.includes('T');
      const parsedDate = new Date(isIso ? rawTime : (rawTime.replace(' ', 'T') + (rawTime.length <= 19 ? 'Z' : '')));
      if (!isNaN(parsedDate.getTime())) {
        const hours = String(parsedDate.getHours()).padStart(2, '0');
        const minutes = String(parsedDate.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    } catch {
      // fallback
    }
    return rawTime;
  };

  const getTodayIsoDate = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getTodayFormattedLabel = () => {
    const today = new Date();
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    return `${today.getDate()} de ${months[today.getMonth()]} de ${today.getFullYear()}`;
  };

  const fetchGuestsForEvent = async (eventId: number) => {
    setLoadingData(true);
    const storageKey = `@wedding_check_guests_${eventId}`;
    try {
      // Cargar caché local del evento de inmediato para evitar destellos
      const cached = await AsyncStorage.getItem(storageKey);
      if (cached) {
        try {
          setGuests(applyPendingOps(JSON.parse(cached), eventId));
        } catch {
          // ignore
        }
      } else {
        setGuests([]);
      }

      const headers = getAuthHeaders(user);
      const res = await fetchWithTimeout(`${APP_URL}/events/${eventId}/guests`, {
        headers,
      });
      if (res.ok) {
        const data = await res.json();
        const rawGuests = Array.isArray(data) ? data : (data.guests || data.data || []);
        const list = rawGuests.map((g: any) => ({
          ...g,
          qr_code: g.qr_code || `WC-${String(g.id).padStart(4, '0')}`,
        }));
        setGuests(applyPendingOps(list, eventId));
        await AsyncStorage.setItem(storageKey, JSON.stringify(list));
      } else {
        if (!cached) {
          setGuests([]);
        }
      }
    } catch {
      // Offline fallback
      try {
        const cached = await AsyncStorage.getItem(storageKey);
        if (cached) {
          setGuests(applyPendingOps(JSON.parse(cached), eventId));
        } else {
          setGuests([]);
        }
      } catch {
        setGuests([]);
      }
    } finally {
      setLoadingData(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshEvents();
    if (selectedEventId) {
      await fetchGuestsForEvent(selectedEventId);
    }
    setRefreshing(false);
  };

  // Marcar / Alternar Acreditación (Check-in en Puerta)
  const toggleCheckIn = async (guest: GuestItem) => {
    if (!isEventToday) {
      Alert.alert(
        'Modo Solo Lectura',
        `No es posible registrar el ingreso porque el evento es el ${formattedEventDate || 'fecha programada'}. Las acciones de acreditación se habilitan únicamente el día del evento.`,
        [{ text: 'Entendido' }]
      );
      return;
    }

    if (!selectedEventId) return;

    const isAttending = guest.status === 'attended';
    const newStatus = isAttending ? 'confirmed' : 'attended';
    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    setUpdatingGuestId(guest.id);

    setGuests((prev) =>
      prev.map((g) =>
        g.id === guest.id
          ? {
            ...g,
            status: newStatus,
            attended_at: newStatus === 'attended' ? timestamp : null,
          }
          : g
      )
    );

    try {
      const result = await sendOrQueue({
        eventId: selectedEventId,
        method: 'PUT',
        path: `/guests/${guest.id}`,
        body: { status: newStatus },
        guestId: guest.id,
        patch: { status: newStatus, attended_at: newStatus === 'attended' ? timestamp : null },
      });
      if (result.status === 'rejected') {
        Alert.alert('No se pudo guardar', `El servidor rechazó el cambio de estado de "${guest.name}".`);
        fetchGuestsForEvent(selectedEventId);
      }
    } finally {
      setUpdatingGuestId(null);
    }
  };

  // Escanear / Validar QR con API Backend
  const handleScanQR = async (codeToScan?: string) => {
    if (!isEventToday) {
      vibrateScan('error');
      Alert.alert(
        'Acreditación No Disponible',
        `El escaneo y validación de entradas solo está habilitado el día del evento (${formattedEventDate || 'fecha programada'}).`,
        [{ text: 'Entendido', onPress: () => setScanned(false) }]
      );
      return;
    }

    const rawQuery = (codeToScan || qrInput).trim();
    if (!rawQuery) {
      setScanned(false);
      return;
    }

    // Extraer token si se escanea URL completa
    let cleanToken = rawQuery;
    if (cleanToken.includes('/confirmar/')) {
      cleanToken = cleanToken.split('/confirmar/').pop() || cleanToken;
    }

    // Búsqueda exacta por código QR o ID (nunca por nombre, para no acreditar a otra persona)
    const foundAny = guests.find(
      (g) =>
        (g.qr_code && g.qr_code.toUpperCase() === cleanToken.toUpperCase()) ||
        String(g.id) === cleanToken
    );

    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Validación con la lista guardada en el dispositivo (sin conexión o servidor no disponible)
    const processLocally = () => {
      if (!foundAny) {
        vibrateScan('error');
        Alert.alert(
          'Código No Encontrado',
          `Sin conexión con el servidor. El código '${cleanToken}' no figura en la lista guardada en el dispositivo.`,
          [{ text: 'Aceptar', onPress: () => setScanned(false) }]
        );
      } else if (foundAny.status === 'attended') {
        setAlreadyUsedResult({
          guest: foundAny,
          timestamp: foundAny.attended_at || timestamp,
        });
      } else if (foundAny.status === 'pending') {
        vibrateScan('error');
        Alert.alert(
          '⚠️ NO CONFIRMADO A TIEMPO',
          `El invitado "${foundAny.name}" no confirmó su asistencia antes de la fecha límite de vencimiento (7 días antes).\n\nNo se encuentra en la lista de acreditación para el ingreso de hoy.`,
          [{ text: 'Entendido', onPress: () => setScanned(false) }]
        );
      } else if (foundAny.status === 'declined') {
        vibrateScan('error');
        Alert.alert(
          '🔴 INVITADO DECLINADO',
          `El invitado "${foundAny.name}" declinó la invitación antes de la fecha de vencimiento.`,
          [{ text: 'Entendido', onPress: () => setScanned(false) }]
        );
      } else {
        toggleCheckIn(foundAny);
        setScanResult({
          guest: { ...foundAny, status: 'attended', attended_at: timestamp },
          timestamp,
        });
      }
    };

    // Sin conexión: validar directo con la lista guardada, sin esperar al servidor
    try {
      const net = await Network.getNetworkStateAsync();
      if (net.isConnected === false || net.isInternetReachable === false) {
        processLocally();
        return;
      }
    } catch {
      // Si no se puede determinar, se intenta con el servidor
    }

    // Con conexión: el servidor es quien decide (la lista local puede estar desactualizada)
    let res: Response;
    let json: any;
    try {
      const headers = getAuthHeaders(user, {
        'Content-Type': 'application/json',
      });
      res = await fetchWithTimeout(`${APP_URL}/check-in/scan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          token: cleanToken,
          event_id: selectedEventId,
        }),
      });
      json = await res.json().catch(() => ({}));
    } catch {
      processLocally();
      return;
    }

    if (res.ok && json.success) {
      // Entrada Válida
      const updatedGuest = json.guest || foundAny;
      if (!updatedGuest) {
        vibrateScan('success');
        Alert.alert('✅ Entrada Válida', 'El invitado fue acreditado correctamente.', [
          { text: 'Aceptar', onPress: () => setScanned(false) },
        ]);
        return;
      }
      setGuests((prev) =>
        prev.map((g) => (String(g.id) === String(updatedGuest.id) ? { ...g, status: 'attended', attended_at: timestamp } : g))
      );
      setScanResult({
        guest: { ...updatedGuest, status: 'attended', attended_at: timestamp },
        timestamp: timestamp,
      });
    } else if (res.status === 409 || json.status === 'already_used' || json.already_attended) {
      // Pase ya utilizado -> Modal emergente
      const usedGuest = json.guest || foundAny || { id: 0, name: 'Invitado Registrado', phone: '', passes: 1, table_number: 'Sin Mesa', status: 'attended' };
      setAlreadyUsedResult({
        guest: usedGuest,
        timestamp: usedGuest.attended_at || timestamp,
      });
    } else if (res.status === 422 || json.status === 'declined') {
      // Invitado Cancelado
      vibrateScan('error');
      Alert.alert(
        '⚠️ INVITADO CANCELADO',
        json.message || 'El invitado figura como No Asistirá.',
        [{ text: 'Aceptar', onPress: () => setScanned(false) }]
      );
    } else if (res.status >= 500 || res.status === 401 || res.status === 408 || res.status === 429) {
      // Servidor no disponible: validar con la lista guardada
      processLocally();
    } else {
      // El servidor respondió que el código no es válido
      vibrateScan('error');
      Alert.alert(
        'Código No Encontrado',
        json.message || `No se encontró ningún invitado registrado con el código '${cleanToken}'.`,
        [{ text: 'Aceptar', onPress: () => setScanned(false) }]
      );
    }
  };

  // Alta Express de Invitados en Puerta
  const handleCreateExpressGuest = async () => {
    if (!isEventToday) {
      Alert.alert(
        'Modo Solo Lectura',
        `El alta express de invitados en puerta solo está habilitada el día del evento (${formattedEventDate || 'fecha programada'}).`,
        [{ text: 'Entendido' }]
      );
      return;
    }

    if (!expressName.trim()) {
      Alert.alert('Nombre requerido', 'Por favor ingresá el nombre y apellido del invitado.');
      return;
    }
    if (!selectedEventId) return;
    setSavingExpress(true);

    const now = new Date();
    const timestamp = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const newGuestId = `exp_${Date.now()}`;
    const newQrCode = `WC-EXP-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const newGuest: GuestItem = {
      id: newGuestId,
      name: expressName.trim(),
      phone: '',
      passes: expressPasses,
      confirmed_passes: expressPasses,
      adults: expressPasses,
      table_number: expressTable.trim() || 'Mesa General',
      status: expressAutoCheckIn ? 'attended' : 'confirmed',
      attended_at: expressAutoCheckIn ? timestamp : null,
      dietary_restrictions: expressDiet.trim() || null,
      notes: 'Invitado Express agregado en puerta',
      qr_code: newQrCode,
    };

    setGuests((prev) => [newGuest, ...prev]);

    let result: Awaited<ReturnType<typeof sendOrQueue>> | null = null;
    try {
      const autoPhone = `099${Math.floor(1000000 + Math.random() * 9000000)}`;
      result = await sendOrQueue({
        eventId: selectedEventId,
        method: 'POST',
        path: `/events/${selectedEventId}/guests`,
        body: {
          name: newGuest.name,
          phone: autoPhone,
          passes: newGuest.passes,
          table_number: newGuest.table_number,
          status: newGuest.status,
          dietary_restrictions: newGuest.dietary_restrictions,
          notes: newGuest.notes,
        },
        guestId: newGuest.id,
        localGuest: { ...newGuest },
      });
    } finally {
      setSavingExpress(false);
      setExpressModalVisible(false);
      const addedName = expressName.trim();
      setExpressName('');
      setExpressPasses(1);
      setExpressTable('');
      setExpressDiet('');

      if (result?.status === 'rejected') {
        Alert.alert('No se pudo registrar', `El servidor rechazó el alta de "${addedName}".`);
        fetchGuestsForEvent(selectedEventId);
      } else {
        // Recargar para obtener el ID real asignado por el servidor
        if (result?.status === 'sent') fetchGuestsForEvent(selectedEventId);
        Alert.alert(
          'Invitado Express Creado',
          `"${addedName}" fue registrado exitosamente${expressAutoCheckIn ? ' y marcado como INGRESADO' : ''}.\n🪑 ${newGuest.table_number} · 🎟️ ${newGuest.passes} pase(s)${result?.status === 'queued' ? '\n\n📶 Sin conexión: se enviará al servidor cuando vuelva la señal.' : ''}`
        );
      }
    }
  };

  // Reasignación de Mesa Rápida
  const handleSaveTableReassignment = async () => {
    if (!reassignGuest || !selectedEventId) return;
    const targetTable = newTableInput.trim() || 'Sin Mesa';
    setSavingTable(true);

    setGuests((prev) =>
      prev.map((g) => (g.id === reassignGuest.id ? { ...g, table_number: targetTable } : g))
    );

    let result: Awaited<ReturnType<typeof sendOrQueue>> | null = null;
    try {
      result = await sendOrQueue({
        eventId: selectedEventId,
        method: 'PUT',
        path: `/guests/${reassignGuest.id}`,
        body: { table_number: targetTable },
        guestId: reassignGuest.id,
        patch: { table_number: targetTable },
      });
    } finally {
      setSavingTable(false);
      const guestName = reassignGuest.name;
      setReassignGuest(null);
      if (result?.status === 'rejected') {
        Alert.alert('No se pudo guardar', `El servidor rechazó el cambio de mesa de "${guestName}".`);
        fetchGuestsForEvent(selectedEventId);
      } else {
        Alert.alert(
          'Mesa Reasignada',
          `La mesa de "${guestName}" fue actualizada a: ${targetTable}${result?.status === 'queued' ? '\n\n📶 Sin conexión: se enviará al servidor cuando vuelva la señal.' : ''}`
        );
      }
    }
  };

  // Protocolo y Alertas VIP
  const isVipGuest = (guest: GuestItem): boolean => {
    if (guest.is_vip) return true;
    const n = (guest.notes || '').toLowerCase();
    const name = (guest.name || '').toLowerCase();
    return (
      n.includes('padrino') ||
      n.includes('madrina') ||
      n.includes('vip') ||
      n.includes('testigo') ||
      n.includes('novia') ||
      n.includes('novio') ||
      n.includes('padres') ||
      n.includes('sobre') ||
      n.includes('regalo') ||
      name.includes('dra.') ||
      name.includes('ing.')
    );
  };

  const getVipBadgeText = (guest: GuestItem): string => {
    if (guest.vip_label) return guest.vip_label;
    const n = (guest.notes || '').toLowerCase();
    if (n.includes('madrina')) return '👑 MADRINA';
    if (n.includes('padrino')) return '👑 PADRINO';
    if (n.includes('testigo')) return '⭐ TESTIGO';
    if (n.includes('novia') || n.includes('novio')) return '💖 FAMILIA NOVIOS';
    if (n.includes('sobre') || n.includes('regalo')) return '🎁 RECIBIR REGALO/SOBRE';
    return '⭐ PROTOCOLO VIP';
  };

  // Reporte en vivo para Cocina / Maître por WhatsApp
  const handleShareKitchenReport = () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const weddingTitle = currentEvent ? currentEvent.title : 'Boda';

    const specialDietGuests = preConfirmedGuests
      .filter((g) => g.status === 'attended' && g.dietary_restrictions)
      .map((g) => `• *${g.name}* (${g.table_number || 'Sin mesa'}): ${g.dietary_restrictions}`)
      .join('\n');

    const message = `👨‍🍳 *REPORTE DE CATERING EN VIVO - WEDDING CHECK*
💍 *${weddingTitle.toUpperCase()}*
⏰ *Hora de corte:* ${timeStr} hs
━━━━━━━━━━━━━━━━━━━━
👥 *Asistencia en salón:* ${stats.attended} familias (${stats.attendedPasses} personas ingresadas)
⏳ *Faltan por llegar:* ${stats.pendingEntrance} familias (${stats.pendingEntrancePasses} personas)

🍽️ *PLATOS A MARCHAR EN SALÓN:*
• 🍽️ *Menús Estándar:* ${stats.standardPasses} platos
${stats.celiacCount > 0 ? `• 🌾 *Sin TACC / Celíacos:* ${stats.celiacCount} platos\n` : ''}${stats.lactoseCount > 0 ? `• 🥛 *Sin Lactosa:* ${stats.lactoseCount} platos\n` : ''}${stats.veggieCount > 0 ? `• 🌱 *Vegetarianos:* ${stats.veggieCount} platos\n` : ''}━━━━━━━━━━━━━━━━━━━━
${specialDietGuests ? `📍 *Comensales especiales que ya ingresaron:*\n${specialDietGuests}\n━━━━━━━━━━━━━━━━━━━━\n` : ''}✨ _Reporte generado por Wedding Check_`;

    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(message)}`).catch(() => {
      Alert.alert('WhatsApp no disponible', 'No se pudo abrir WhatsApp.');
    });
  };

  const getGuestPasses = (g: any): number => {
    if (typeof g.confirmed_passes === 'number') {
      return Math.max(0, g.confirmed_passes);
    }
    if (typeof g.passes === 'number') {
      return Math.max(0, g.passes);
    }
    return 1;
  };

  const isGuestAttending = (g: any): boolean => {
    // 1. Excluir explícitamente a los que declinaron o cancelaron
    if (g.status === 'declined' || g.rsvp_status === 'declined') return false;
    if (g.status === 'cancelled' || g.status === 'rejected' || g.status === 'no_asiste') return false;
    if (g.will_attend === false || g.attendance === false || g.attending === false) return false;

    // 2. Si confirmó 0 pases, no asiste al evento
    if (typeof g.confirmed_passes === 'number' && g.confirmed_passes <= 0) return false;
    if (typeof g.passes === 'number' && g.passes <= 0 && g.confirmed_passes === undefined) return false;

    // 3. No incluir pendientes de confirmación en la acreditación de puerta
    if (g.status === 'pending' || g.rsvp_status === 'pending_rsvp') return false;

    // 4. Debe tener estado de asistencia confirmada o que ya ingresó
    const isConfirmed = g.status === 'confirmed' || g.rsvp_status === 'confirmed';
    const isAttended = g.status === 'attended';

    return isConfirmed || isAttended;
  };

  // Lista de invitados que CONFIRMARON y ASISTIRÁN al evento
  const preConfirmedGuests = useMemo(() => {
    return guests.filter((g) => isGuestAttending(g));
  }, [guests]);

  // Filtrado en tiempo real en la lista de recepción
  const filteredGuests = useMemo(() => {
    return preConfirmedGuests.filter((g) => {
      const matchQuery =
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.table_number && g.table_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (g.qr_code && g.qr_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        g.phone.includes(searchQuery);

      if (!matchQuery) return false;

      if (filterStatus === 'attended') return g.status === 'attended';
      if (filterStatus === 'pending') return g.status !== 'attended';
      return true;
    });
  }, [preConfirmedGuests, searchQuery, filterStatus]);

  // Agrupamiento por Mesas (Exclusivo invitados confirmados)
  const tableGroups = useMemo(() => {
    const groups: { [key: string]: GuestItem[] } = {};
    preConfirmedGuests.forEach((g) => {
      const tableKey = g.table_number || 'Sin Mesa Asignada';
      if (!groups[tableKey]) {
        groups[tableKey] = [];
      }
      groups[tableKey].push(g);
    });
    return groups;
  }, [preConfirmedGuests]);

  const existingTableNames = useMemo(() => {
    return Object.keys(tableGroups).filter((t) => t !== 'Sin Mesa Asignada');
  }, [tableGroups]);

  // Cálculo de Métricas de Puerta en Vivo (Día del Evento - Solo Invitados que Asistirán)
  const stats = useMemo(() => {
    const total = preConfirmedGuests.length;
    const attended = preConfirmedGuests.filter((g) => g.status === 'attended').length;
    const pendingEntrance = Math.max(0, total - attended);

    const totalPasses = preConfirmedGuests.reduce((acc, g) => acc + getGuestPasses(g), 0);
    const attendedPasses = preConfirmedGuests
      .filter((g) => g.status === 'attended')
      .reduce((acc, g) => acc + getGuestPasses(g), 0);
    const pendingEntrancePasses = Math.max(0, totalPasses - attendedPasses);

    const progressPercent = total > 0 ? Math.round((attended / total) * 100) : 0;

    const lactoseCount = preConfirmedGuests.filter((g) =>
      g.dietary_restrictions?.toLowerCase().includes('lactosa')
    ).length;
    const celiacCount = preConfirmedGuests.filter(
      (g) =>
        g.dietary_restrictions?.toLowerCase().includes('tacc') ||
        g.dietary_restrictions?.toLowerCase().includes('celíac')
    ).length;
    const veggieCount = preConfirmedGuests.filter(
      (g) =>
        g.dietary_restrictions?.toLowerCase().includes('vegetar') ||
        g.dietary_restrictions?.toLowerCase().includes('vegan')
    ).length;

    const totalSpecialCount = lactoseCount + celiacCount + veggieCount;
    const standardPasses = Math.max(0, totalPasses - totalSpecialCount);

    return {
      total,
      attended,
      pendingEntrance,
      totalPasses,
      attendedPasses,
      pendingEntrancePasses,
      progressPercent,
      lactoseCount,
      celiacCount,
      veggieCount,
      totalSpecialCount,
      standardPasses,
    };
  }, [preConfirmedGuests]);

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

        {/* Header Superior */}
        <View style={styles.headerBar}>
          <View style={styles.headerTitleCol}>
            {isEventToday ? (
              <View style={styles.todayHeaderBadge}>
                <ThemedText style={styles.todayHeaderBadgeText}>
                  📅 EVENTO DE HOY · {getTodayFormattedLabel()}
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.todayHeaderBadge, styles.readOnlyHeaderBadge]}>
                <ThemedText style={styles.readOnlyHeaderBadgeText}>
                  🔒 MODO CONSULTA · {formattedEventDate || currentEvent?.event_date}
                </ThemedText>
              </View>
            )}
            <ThemedText type="subtitle" style={styles.headerTitle}>
              {currentEvent ? currentEvent.title : 'Recepción de Invitados'}
            </ThemedText>
            {currentEvent?.location ? (
              <ThemedText style={styles.locationText} themeColor="textSecondary">
                📍 {currentEvent.location}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#e11d48']} />
          }>

          {/* Cambios realizados sin conexión pendientes de enviar al servidor */}
          {pendingCountForEvent > 0 && (
            <Pressable onPress={flush} disabled={isSyncing} style={styles.pendingSyncBox}>
              {isSyncing ? (
                <ActivityIndicator size="small" color="#1d4ed8" />
              ) : (
                <Ionicons name="cloud-upload-outline" size={22} color="#1d4ed8" />
              )}
              <View style={styles.readOnlyNoticeContent}>
                <ThemedText style={styles.pendingSyncTitle}>
                  {pendingCountForEvent} cambio(s) pendientes de sincronizar
                </ThemedText>
                <ThemedText style={styles.pendingSyncDesc}>
                  {isSyncing
                    ? 'Enviando cambios al servidor...'
                    : 'Se enviarán automáticamente al volver la conexión. Tocá para reintentar ahora.'}
                </ThemedText>
              </View>
            </Pressable>
          )}

          {/* Banner Informativo si no es la fecha del evento */}
          {!isEventToday && (
            <View style={styles.readOnlyNoticeBox}>
              <Ionicons name="information-circle" size={22} color="#b45309" />
              <View style={styles.readOnlyNoticeContent}>
                <ThemedText style={styles.readOnlyNoticeTitle}>
                  Modo de Solo Lectura (Consulta)
                </ThemedText>
                <ThemedText style={styles.readOnlyNoticeDesc}>
                  Este evento es el <ThemedText style={styles.readOnlyNoticeDate}>{formattedEventDate || currentEvent?.event_date || 'otra fecha'}</ThemedText>. La acreditación y el registro de ingresos se habilitarán el día del evento.
                </ThemedText>
              </View>
            </View>
          )}

          {/* Botón Principal Adaptable de Escáner QR de Ingreso */}
          <Pressable
            onPress={() => {
              if (!isEventToday) {
                Alert.alert(
                  'Acreditación No Habilitada',
                  `El escaneo de entradas y acreditación en puerta solo están habilitados el día del evento (${formattedEventDate || 'fecha programada'}).\n\nActualmente puedes consultar la información en modo de solo lectura.`,
                  [{ text: 'Entendido' }]
                );
                return;
              }
              setScannerVisible(true);
            }}
            style={styles.heroQrButton}>
            <LinearGradient
              colors={isEventToday ? ['#FF0055', '#E61E50', '#F97316'] : ['#475569', '#334155', '#1e293b']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.heroQrGradient}>
              <ThemedText style={styles.heroQrIcon}>{isEventToday ? '🎟️' : '🔒'}</ThemedText>
              <View style={styles.heroQrCol}>
                <ThemedText style={styles.heroQrTitle}>
                  {isEventToday ? 'ESCANEAR CÓDIGO QR' : 'ACREDITACIÓN BLOQUEADA (SOLO LECTURA)'}
                </ThemedText>
                <ThemedText style={styles.heroQrSub}>
                  {isEventToday
                    ? 'Validar y acreditar ingreso de invitados'
                    : `Habilitado únicamente el día del evento (${formattedEventDate})`}
                </ThemedText>
              </View>
              <ThemedText style={styles.heroQrArrow}>{isEventToday ? '➔' : 'ℹ️'}</ThemedText>
            </LinearGradient>
          </Pressable>

          {/* Tarjetas de Métricas de Puerta (SOLO Ingresaron y Faltan por Ingresar) */}
          <View style={styles.statsRow}>
            <LinearGradient
              colors={['#10b981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.statCard}>
              <ThemedText style={styles.statNumber}>
                {stats.attended}
              </ThemedText>
              <ThemedText style={styles.statLabel}>
                ✅ INGRESARON
              </ThemedText>
              <ThemedText style={styles.statSub}>
                {stats.attendedPasses} pases dentro
              </ThemedText>
            </LinearGradient>

            <View style={styles.statCardSecondary}>
              <ThemedText style={styles.statNumberAmber}>
                {stats.pendingEntrance}
              </ThemedText>
              <ThemedText style={styles.statLabelDark}>
                ⏳ FALTAN INGRESAR
              </ThemedText>
              <ThemedText style={styles.statSubDark}>
                {stats.pendingEntrancePasses} pases por llegar
              </ThemedText>
            </View>

            <View style={styles.statCardSecondary}>
              <ThemedText style={styles.statNumberDark}>
                {stats.total}
              </ThemedText>
              <ThemedText style={styles.statLabelDark}>
                👥 TOTAL CONFIRMADOS
              </ThemedText>
              <ThemedText style={styles.statSubDark}>
                {stats.totalPasses} pases esperados
              </ThemedText>
            </View>
          </View>

          {/* Barra de Progreso de Ingreso del Día del Evento */}
          <View style={styles.progressCard}>
            <View style={styles.progressHeaderRow}>
              <ThemedText style={styles.progressTitle}>
                ⏱️ {stats.attended} de {stats.total} confirmados ingresaron ({stats.progressPercent}%)
              </ThemedText>
              <ThemedText style={styles.progressSubText}>
                {stats.pendingEntrance} por llegar
              </ThemedText>
            </View>
            <View style={styles.progressBarTrack}>
              <View style={[styles.progressBarFill, { width: `${stats.progressPercent}%` }]} />
            </View>

            {/* Control de Catering Diferenciado para la Planner y Cocina/Mozos */}
            <View style={styles.cateringBox}>
              <View style={styles.cateringHeaderCol}>
                <ThemedText style={styles.cateringBoxTitle}>🥗 Control de Catering & Menú</ThemedText>
                <ThemedText style={styles.cateringBoxSub}>
                  El menú general del evento es estándar ({stats.totalPasses} pases totales confirmados). Las restricciones aplican únicamente al invitado indicado:
                </ThemedText>
              </View>

              <View style={styles.cateringBadgesRow}>
                <View style={styles.cateringBadgeStandard}>
                  <ThemedText style={styles.cateringBadgeStandardText}>
                    🍽️ {stats.standardPasses} Menús Estándar
                  </ThemedText>
                </View>

                {stats.lactoseCount > 0 && (
                  <View style={styles.cateringBadgeSpecial}>
                    <ThemedText style={styles.cateringBadgeSpecialText}>
                      🥛 {stats.lactoseCount} Sin Lactosa
                    </ThemedText>
                  </View>
                )}

                {stats.celiacCount > 0 && (
                  <View style={styles.cateringBadgeSpecial}>
                    <ThemedText style={styles.cateringBadgeSpecialText}>
                      🌾 {stats.celiacCount} Sin TACC
                    </ThemedText>
                  </View>
                )}

                {stats.veggieCount > 0 && (
                  <View style={styles.cateringBadgeSpecial}>
                    <ThemedText style={styles.cateringBadgeSpecialText}>
                      🌱 {stats.veggieCount} Vegetariano
                    </ThemedText>
                  </View>
                )}
              </View>

              {/* Botón WhatsApp Cocina / Maître */}
              <Pressable onPress={handleShareKitchenReport} style={styles.kitchenShareBtn}>
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.kitchenShareGradient}>
                  <Ionicons name="logo-whatsapp" size={17} color="#ffffff" />
                  <ThemedText style={styles.kitchenShareTitle}>
                    ENVIAR REPORTE A COCINA
                  </ThemedText>
                </LinearGradient>
              </Pressable>
            </View>
          </View>

          {/* Conmutador de Vistas Internas: Lista vs Invitados por mesa */}
          <View style={styles.modeToggleRow}>
            <Pressable
              onPress={() => setViewMode('list')}
              style={[styles.toggleBtn, viewMode === 'list' && styles.toggleBtnActive]}>
              <ThemedText style={[styles.toggleBtnText, viewMode === 'list' && styles.toggleBtnTextActive]}>
                📋 Lista de puerta ({filteredGuests.length})
              </ThemedText>
            </Pressable>

            <Pressable
              onPress={() => setViewMode('tables')}
              style={[styles.toggleBtn, viewMode === 'tables' && styles.toggleBtnActive]}>
              <ThemedText style={[styles.toggleBtnText, viewMode === 'tables' && styles.toggleBtnTextActive]}>
                🪑 Invitados por mesa ({Object.keys(tableGroups).length})
              </ThemedText>
            </Pressable>
          </View>

          {viewMode === 'list' ? (
            <>
              {/* Búsqueda en Puerta y Alta Express */}
              <View style={styles.searchSection}>
                <View style={styles.searchRowWithExpress}>
                  <View style={styles.searchInputWrapper}>
                    <Ionicons name="search" size={20} color="#64748b" style={styles.searchIcon} />
                    <TextInput
                      style={styles.searchInput}
                      placeholder="Buscar por nombre, mesa o QR..."
                      placeholderTextColor="#94a3b8"
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      autoCapitalize="none"
                      autoCorrect={false}
                      selectionColor="#e11d48"
                    />
                    {searchQuery.length > 0 && (
                      <Pressable
                        onPress={() => setSearchQuery('')}
                        hitSlop={8}
                        style={styles.clearBtn}>
                        <Ionicons name="close-circle" size={19} color="#94a3b8" />
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={() => {
                      if (!isEventToday) {
                        Alert.alert(
                          'Modo Solo Lectura',
                          `El alta express de invitados en puerta solo está habilitada el día del evento (${formattedEventDate || 'fecha programada'}).`,
                          [{ text: 'Entendido' }]
                        );
                        return;
                      }
                      setExpressModalVisible(true);
                    }}
                    style={[styles.expressBtn, !isEventToday && { opacity: 0.6 }]}>
                    <Ionicons name="person-add" size={15} color="#ffffff" />
                    <ThemedText style={styles.expressBtnText}>+ Express</ThemedText>
                  </Pressable>
                </View>

                {/* Filtros Rápidos en Puerta */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPills}>
                  <Pressable
                    onPress={() => setFilterStatus('all')}
                    style={[styles.pill, filterStatus === 'all' && styles.pillActive]}>
                    <ThemedText style={[styles.pillText, filterStatus === 'all' && styles.pillTextActive]}>
                      Todos ({preConfirmedGuests.length})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterStatus('attended')}
                    style={[styles.pill, filterStatus === 'attended' && styles.pillActiveAttended]}>
                    <ThemedText style={[styles.pillText, filterStatus === 'attended' && styles.pillTextActive]}>
                      ✅ Ingresaron ({stats.attended})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setFilterStatus('pending')}
                    style={[styles.pill, filterStatus === 'pending' && styles.pillActive]}>
                    <ThemedText style={[styles.pillText, filterStatus === 'pending' && styles.pillTextActive]}>
                      ⏳ Faltan Ingresar ({stats.pendingEntrance})
                    </ThemedText>
                  </Pressable>
                </ScrollView>
              </View>

              {/* Lista de Invitados en Puerta */}
              <View style={styles.guestListSection}>
                <ThemedText style={styles.sectionTitle}>
                  ACREDITACIÓN EN PUERTA ({filteredGuests.length})
                </ThemedText>

                {filteredGuests.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <ThemedText style={styles.emptyIcon}>🔍</ThemedText>
                    <ThemedText style={styles.emptyText}>
                      No se encontraron invitados con el filtro o búsqueda actual.
                    </ThemedText>
                  </View>
                ) : (
                  filteredGuests.map((guest) => {
                    const isAttended = guest.status === 'attended';
                    const isUpdating = updatingGuestId === guest.id;

                    return (
                      <Pressable
                        key={guest.id}
                        onPress={() => setTicketModalGuest(guest)}
                        style={[
                          styles.guestCard,
                          isAttended && styles.guestCardAttended,
                        ]}>

                        <View style={styles.guestInfoCol}>
                          <View style={styles.guestNameRow}>
                            <ThemedText style={styles.guestName}>
                              {guest.name}
                            </ThemedText>

                            {isVipGuest(guest) && (
                              <View style={styles.vipListBadge}>
                                <ThemedText style={styles.vipListBadgeText}>
                                  {getVipBadgeText(guest)}
                                </ThemedText>
                              </View>
                            )}

                            {isAttended ? (
                              <View style={styles.attendedBadge}>
                                <ThemedText style={styles.attendedBadgeText}>
                                  ✅ INGRESÓ {guest.attended_at ? `(${formatDisplayTime(guest.attended_at)})` : ''}
                                </ThemedText>
                              </View>
                            ) : (
                              <View style={styles.confirmedBadge}>
                                <ThemedText style={styles.confirmedBadgeText}>
                                  📋 CONFIRMADO
                                </ThemedText>
                              </View>
                            )}
                          </View>

                          <View style={styles.detailsRow}>
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                setReassignGuest(guest);
                                setNewTableInput(guest.table_number || '');
                              }}
                              style={styles.tableBadgeProminentClickable}>
                              <ThemedText style={styles.tableTextProminent}>
                                🪑 {guest.table_number ? (guest.table_number.toLowerCase().includes('mesa') ? guest.table_number : `Mesa: ${guest.table_number}`) : 'Sin Mesa'} ✏️
                              </ThemedText>
                            </Pressable>

                            <View style={styles.passesBadgeSubtle}>
                              <ThemedText style={styles.passesTextSubtle}>
                                🎟️ {getGuestPasses(guest)} pases · {guest.qr_code}
                              </ThemedText>
                            </View>
                          </View>

                          {guest.dietary_restrictions ? (
                            <View style={styles.dietBox}>
                              <ThemedText style={styles.dietText}>
                                🥗 {guest.dietary_restrictions}
                              </ThemedText>
                            </View>
                          ) : null}

                          {guest.notes ? (
                            <ThemedText style={styles.notesText} themeColor="textSecondary">
                              📝 {guest.notes}
                            </ThemedText>
                          ) : null}
                        </View>

                        <Pressable
                          disabled={isUpdating}
                          onPress={(e) => {
                            e.stopPropagation();
                            if (!isEventToday) {
                              Alert.alert(
                                'Modo Solo Lectura',
                                `No se puede marcar el ingreso porque el evento es el ${formattedEventDate || 'fecha programada'}. Las acciones de acreditación se habilitan el día del evento.`,
                                [{ text: 'Entendido' }]
                              );
                              return;
                            }
                            setConfirmToggleGuest(guest);
                          }}
                          style={[
                            styles.checkInBtn,
                            isAttended
                              ? styles.checkInBtnActive
                              : isEventToday
                              ? styles.checkInBtnPending
                              : styles.checkInBtnReadOnly,
                          ]}>
                          {isUpdating ? (
                            <ActivityIndicator color="#ffffff" size="small" />
                          ) : (
                            <ThemedText
                              style={[
                                styles.checkInBtnText,
                                !isAttended && !isEventToday && styles.checkInBtnTextReadOnly,
                              ]}>
                              {isAttended ? '✅ DENTRO' : isEventToday ? '🟢 INGRESAR' : '⏳ PENDIENTE'}
                            </ThemedText>
                          )}
                        </Pressable>

                      </Pressable>
                    );
                  })
                )}
              </View>
            </>
          ) : (
            /* Vista por Mesas */
            <View style={styles.tablesContainer}>
              <ThemedText style={styles.sectionTitle}>
                INVITADOS POR MESA ({Object.keys(tableGroups).length})
              </ThemedText>

              {Object.entries(tableGroups).map(([tableName, tableGuests]) => {
                const attendedInTable = tableGuests.filter((g) => g.status === 'attended').length;
                const totalInTable = tableGuests.reduce((acc, g) => acc + getGuestPasses(g), 0);

                return (
                  <View key={tableName} style={styles.tableCardContainer}>
                    <View style={styles.tableCardHeader}>
                      <View style={styles.tableTitleCol}>
                        <ThemedText style={styles.tableCardTitle}>
                          🪑 {tableName}
                        </ThemedText>
                        <ThemedText style={styles.tableCardSub}>
                          {tableGuests.length} familias/invitados ({totalInTable} personas)
                        </ThemedText>
                      </View>

                      <View style={styles.tableCountBadge}>
                        <ThemedText style={styles.tableCountText}>
                          {attendedInTable} / {tableGuests.length} en mesa
                        </ThemedText>
                      </View>
                    </View>

                    <View style={styles.tableGuestList}>
                      {tableGuests.map((g) => (
                        <View key={g.id} style={styles.tableGuestRow}>
                          <ThemedText style={styles.tableGuestName}>
                            {g.status === 'attended' ? '🟢' : '⚪'} {g.name}
                          </ThemedText>

                          <View style={styles.tableGuestDetails}>
                            {g.dietary_restrictions ? (
                              <ThemedText style={styles.tableDietText}>
                                🥗 {g.dietary_restrictions}
                              </ThemedText>
                            ) : null}
                            <ThemedText style={styles.tablePassesText}>
                              {getGuestPasses(g)} pases
                            </ThemedText>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

        </ScrollView>
      </SafeAreaView>

      {/* Modal de Escáner QR Estilo Cámara Nativa de Smartphone */}
      <Modal visible={scannerVisible} animationType="fade" statusBarTranslucent transparent={false}>
        <View style={styles.fullScreenCameraContainer}>
          {/* Cámara a Pantalla Completa */}
          {!permission ? (
            <View style={styles.cameraCenterContainer}>
              <ActivityIndicator size="large" color="#ffffff" />
              <ThemedText style={{ marginTop: 12, color: '#ffffff', fontWeight: '700' }}>
                Iniciando cámara...
              </ThemedText>
            </View>
          ) : !permission.granted ? (
            <View style={styles.cameraCenterContainer}>
              <ThemedText style={styles.permissionText}>
                Se requieren permisos para acceder a la cámara y escanear las entradas QR.
              </ThemedText>
              <Button title="Conceder Permiso de Cámara" onPress={requestPermission} style={{ marginTop: 16 }} />
            </View>
          ) : (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torchEnabled}
              barcodeScannerSettings={{
                barcodeTypes: ['qr'],
              }}
              onBarcodeScanned={
                scanned
                  ? undefined
                  : ({ data }) => {
                    if (scanLockRef.current) return;
                    scanLockRef.current = true;
                    setScanned(true);
                    handleScanQR(data);
                  }
              }
            />
          )}

          {/* CAPA SUPERIOR: Interfaz estilo teléfono nativo */}
          <SafeAreaView style={styles.cameraOverlaySafeArea}>
            {/* Mensaje Superior y Botón Cerrar */}
            <View style={styles.cameraTopBar}>
              <View style={{ width: 40 }} />
              <ThemedText style={styles.cameraPromptText}>
                Busque un código QR
              </ThemedText>
              <Pressable
                onPress={() => {
                  setScannerVisible(false);
                  setScanResult(null);
                  setScanned(false);
                }}
                style={styles.cameraCloseBtn}>
                <ThemedText style={styles.cameraCloseBtnText}>✕</ThemedText>
              </Pressable>
            </View>

            {/* MARCO CENTRAL: Esquinas Blancas de Encuadre */}
            <View style={styles.cameraReticleContainer}>
              <View style={styles.cameraReticleBox}>
                <View style={[styles.cornerBracket, styles.cornerTL]} />
                <View style={[styles.cornerBracket, styles.cornerTR]} />
                <View style={[styles.cornerBracket, styles.cornerBL]} />
                <View style={[styles.cornerBracket, styles.cornerBR]} />
              </View>
            </View>

            {/* PANEL INFERIOR: CONTROLES DE LINTERNA Y ACCESOS RÁPIDOS */}
            <View style={styles.cameraBottomPanel}>
              <View style={styles.cameraActionButtonsRow}>
                {/* Botón Flotante Linterna / Flash */}
                <Pressable
                  onPress={() => setTorchEnabled((prev) => !prev)}
                  style={[styles.floatingCircleBtn, torchEnabled && styles.floatingCircleBtnActive]}>
                  <ThemedText style={styles.floatingBtnIcon}>{torchEnabled ? '🔦' : '💡'}</ThemedText>
                </Pressable>

                {/* Chips de prueba: solo visibles en desarrollo, nunca en la app publicada */}
                {__DEV__ && (
                <View style={styles.quickScanRowInline}>
                  <Pressable
                    onPress={() => {
                      setScanned(true);
                      handleScanQR('WC-0248');
                    }}
                    style={styles.quickScanChipGlass}>
                    <ThemedText style={styles.quickScanChipGlassText}>Cynthia</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setScanned(true);
                      handleScanQR('WC-0101');
                    }}
                    style={styles.quickScanChipGlass}>
                    <ThemedText style={styles.quickScanChipGlassText}>Carlos</ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setScanned(true);
                      handleScanQR('WC-0105');
                    }}
                    style={styles.quickScanChipGlassWarning}>
                    <ThemedText style={styles.quickScanChipGlassWarningText}>No Confirmó</ThemedText>
                  </Pressable>
                </View>
                )}
              </View>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Modal Pop-Up de Resultado: INVITADO REGISTRADO */}
      <Modal visible={Boolean(scanResult)} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.registeredModalCard}>
            {/* Header Verde Gradiente */}
            <LinearGradient
              colors={['#10b981', '#059669']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.registeredHeader}>
              <View style={styles.registeredBadge}>
                <ThemedText style={styles.registeredBadgeText}>✅ INVITADO REGISTRADO</ThemedText>
              </View>
              <ThemedText style={styles.registeredGuestName} numberOfLines={2}>
                {scanResult?.guest.name}
              </ThemedText>
              {scanResult?.guest.qr_code ? (
                <ThemedText style={styles.registeredQrCode}>
                  Código: {scanResult.guest.qr_code}
                </ThemedText>
              ) : null}
            </LinearGradient>

            {scanResult && (
              <View style={styles.registeredBody}>
                {/* Banner de Protocolo / Alerta VIP */}
                {isVipGuest(scanResult.guest) && (
                  <View style={styles.vipScanBanner}>
                    <View style={styles.vipScanBadgeRow}>
                      <ThemedText style={styles.vipScanBadgeText}>👑 ATENCIÓN PROTOCOLO / VIP</ThemedText>
                    </View>
                    <ThemedText style={styles.vipScanTitle}>
                      {getVipBadgeText(scanResult.guest)}
                    </ThemedText>
                    {scanResult.guest.notes ? (
                      <ThemedText style={styles.vipScanNotes}>
                        📝 {scanResult.guest.notes}
                      </ThemedText>
                    ) : null}
                  </View>
                )}

                {/* Rejilla: Mesa Asignada y Pases */}
                <View style={styles.registeredGridRow}>
                  <View style={styles.registeredGridItemProminent}>
                    <ThemedText style={styles.registeredGridLabel}>🪑 MESA ASIGNADA</ThemedText>
                    <ThemedText style={styles.registeredGridValProminent}>
                      {scanResult.guest.table_number
                        ? (scanResult.guest.table_number.toLowerCase().includes('mesa')
                          ? scanResult.guest.table_number
                          : `Mesa ${scanResult.guest.table_number}`)
                        : 'Sin Mesa Asignada'}
                    </ThemedText>
                  </View>

                  <View style={styles.registeredGridItem}>
                    <ThemedText style={styles.registeredGridLabel}>🎟️ PASES</ThemedText>
                    <ThemedText style={styles.registeredGridVal}>
                      {scanResult.guest.confirmed_passes || scanResult.guest.passes || 1} Persona(s)
                    </ThemedText>
                  </View>
                </View>

                {/* Restricción Alimentaria */}
                <View
                  style={[
                    styles.registeredDietBox,
                    scanResult.guest.dietary_restrictions
                      ? styles.registeredDietBoxActive
                      : styles.registeredDietBoxStandard,
                  ]}>
                  <View style={styles.registeredDietHeaderRow}>
                    <ThemedText style={styles.registeredDietIcon}>
                      {scanResult.guest.dietary_restrictions ? '⚠️' : '🥗'}
                    </ThemedText>
                    <ThemedText style={styles.registeredDietTitle}>
                      Restricción Alimenticia:
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[
                      styles.registeredDietVal,
                      scanResult.guest.dietary_restrictions
                        ? styles.registeredDietValActive
                        : styles.registeredDietValStandard,
                    ]}>
                    {scanResult.guest.dietary_restrictions
                      ? scanResult.guest.dietary_restrictions
                      : 'Ninguna (Menú Estándar Boda)'}
                  </ThemedText>
                </View>

                {/* Timestamp de Ingreso */}
                <View style={styles.registeredTimeBox}>
                  <ThemedText style={styles.registeredTimeText}>
                    🕘 Acreditado e ingresado a las {formatDisplayTime(scanResult.timestamp)} hs
                  </ThemedText>
                </View>

                {/* Botón de Escanear Siguiente */}
                <Pressable
                  onPress={() => {
                    setScanResult(null);
                    setScanned(false);
                  }}
                  style={styles.registeredNextBtn}>
                  <LinearGradient
                    colors={['#059669', '#10b981']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.registeredNextBtnGradient}>
                    <ThemedText style={styles.registeredNextBtnText}>
                      📷 ESCANEAR SIGUIENTE QR
                    </ThemedText>
                  </LinearGradient>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal Pop-Up de Resultado: PASE YA UTILIZADO */}
      <Modal visible={Boolean(alreadyUsedResult)} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.alreadyUsedModalCard}>
            {/* Header Naranja/Ámbar Gradiente de Advertencia */}
            <LinearGradient
              colors={['#ea580c', '#c2410c']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.alreadyUsedHeader}>
              <View style={styles.alreadyUsedBadge}>
                <ThemedText style={styles.alreadyUsedBadgeText}>⚠️ PASE YA UTILIZADO</ThemedText>
              </View>
              <ThemedText style={styles.alreadyUsedGuestName} numberOfLines={2}>
                {alreadyUsedResult?.guest.name}
              </ThemedText>
              {alreadyUsedResult?.guest.qr_code ? (
                <ThemedText style={styles.alreadyUsedQrCode}>
                  Código: {alreadyUsedResult.guest.qr_code}
                </ThemedText>
              ) : null}
            </LinearGradient>

            {alreadyUsedResult && (
              <View style={styles.alreadyUsedBody}>
                {/* Banner de Alerta Destacado */}
                <View style={styles.alreadyUsedWarningBanner}>
                  <ThemedText style={styles.alreadyUsedWarningIcon}>⛔</ThemedText>
                  <ThemedText style={styles.alreadyUsedWarningText}>
                    Este pase ya fue escaneado e ingresado previamente en la recepción. El invitado ya se encuentra en el evento.
                  </ThemedText>
                </View>

                {/* Rejilla: Mesa Asignada y Pases */}
                <View style={styles.registeredGridRow}>
                  <View style={styles.alreadyUsedGridItemProminent}>
                    <ThemedText style={styles.registeredGridLabel}>🪑 MESA ASIGNADA</ThemedText>
                    <ThemedText style={styles.alreadyUsedGridValProminent}>
                      {alreadyUsedResult.guest.table_number
                        ? (alreadyUsedResult.guest.table_number.toLowerCase().includes('mesa')
                          ? alreadyUsedResult.guest.table_number
                          : `Mesa ${alreadyUsedResult.guest.table_number}`)
                        : 'Sin Mesa Asignada'}
                    </ThemedText>
                  </View>

                  <View style={styles.registeredGridItem}>
                    <ThemedText style={styles.registeredGridLabel}>🎟️ PASES</ThemedText>
                    <ThemedText style={styles.registeredGridVal}>
                      {alreadyUsedResult.guest.confirmed_passes || alreadyUsedResult.guest.passes || 1} Persona(s)
                    </ThemedText>
                  </View>
                </View>

                {/* Restricción Alimentaria */}
                <View
                  style={[
                    styles.registeredDietBox,
                    alreadyUsedResult.guest.dietary_restrictions
                      ? styles.registeredDietBoxActive
                      : styles.registeredDietBoxStandard,
                  ]}>
                  <View style={styles.registeredDietHeaderRow}>
                    <ThemedText style={styles.registeredDietIcon}>
                      {alreadyUsedResult.guest.dietary_restrictions ? '⚠️' : '🥗'}
                    </ThemedText>
                    <ThemedText style={styles.registeredDietTitle}>
                      Restricción Alimenticia:
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[
                      styles.registeredDietVal,
                      alreadyUsedResult.guest.dietary_restrictions
                        ? styles.registeredDietValActive
                        : styles.registeredDietValStandard,
                    ]}>
                    {alreadyUsedResult.guest.dietary_restrictions
                      ? alreadyUsedResult.guest.dietary_restrictions
                      : 'Ninguna (Menú Estándar Boda)'}
                  </ThemedText>
                </View>

                {/* Timestamp de Ingreso */}
                <View style={styles.alreadyUsedTimeBox}>
                  <ThemedText style={styles.alreadyUsedTimeText}>
                    🕘 Ingresó previamente a las {formatDisplayTime(alreadyUsedResult.guest.attended_at || alreadyUsedResult.timestamp)} hs
                  </ThemedText>
                </View>

                {/* Botón de Escanear Siguiente */}
                <Pressable
                  onPress={() => {
                    setAlreadyUsedResult(null);
                    setScanned(false);
                  }}
                  style={styles.alreadyUsedNextBtn}>
                  <LinearGradient
                    colors={['#ea580c', '#c2410c']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.registeredNextBtnGradient}>
                    <ThemedText style={styles.registeredNextBtnText}>
                      📷 ESCANEAR SIGUIENTE QR
                    </ThemedText>
                  </LinearGradient>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal Pop-Up de Confirmación de Cambio de Estado Manual */}
      <Modal visible={Boolean(confirmToggleGuest)} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.confirmToggleModalCard}>
            {/* Header Gradiente dinámico (Ámbar para Revertir, Verde para Ingreso Manual) */}
            <LinearGradient
              colors={
                confirmToggleGuest?.status === 'attended'
                  ? ['#ea580c', '#c2410c']
                  : ['#10b981', '#059669']
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.confirmToggleHeader}>
              <View style={styles.confirmToggleBadge}>
                <ThemedText style={styles.confirmToggleBadgeText}>
                  {confirmToggleGuest?.status === 'attended' ? '⚠️ CONFIRMAR CAMBIO' : '🟢 INGRESO MANUAL'}
                </ThemedText>
              </View>
              <ThemedText style={styles.confirmToggleGuestName} numberOfLines={2}>
                {confirmToggleGuest?.name}
              </ThemedText>
            </LinearGradient>

            {confirmToggleGuest && (
              <View style={styles.confirmToggleBody}>
                {confirmToggleGuest.status === 'attended' ? (
                  <>
                    <View style={styles.confirmToggleWarningBox}>
                      <ThemedText style={styles.confirmToggleWarningIcon}>🔄</ThemedText>
                      <ThemedText style={styles.confirmToggleWarningText}>
                        Este invitado figura como <ThemedText style={{ fontWeight: '900' }}>INGRESADO</ThemedText> (acreditado a las {formatDisplayTime(confirmToggleGuest.attended_at)} hs).
                      </ThemedText>
                    </View>

                    <ThemedText style={styles.confirmToggleQuestionText}>
                      ¿Deseas revertir su acreditación y volverlo a colocar como pendiente de ingreso?
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <View style={styles.confirmToggleDetailsGrid}>
                      <View style={styles.confirmToggleGridItem}>
                        <ThemedText style={styles.registeredGridLabel}>🪑 MESA</ThemedText>
                        <ThemedText style={styles.registeredGridVal}>
                          {confirmToggleGuest.table_number || 'Sin Mesa'}
                        </ThemedText>
                      </View>
                      <View style={styles.confirmToggleGridItem}>
                        <ThemedText style={styles.registeredGridLabel}>🎟️ PASES</ThemedText>
                        <ThemedText style={styles.registeredGridVal}>
                          {confirmToggleGuest.confirmed_passes || confirmToggleGuest.passes || 1} Persona(s)
                        </ThemedText>
                      </View>
                    </View>

                    <ThemedText style={styles.confirmToggleQuestionText}>
                      ¿Confirmas el ingreso manual de este invitado a la recepción sin escanear código QR?
                    </ThemedText>
                  </>
                )}

                {/* Botones de Acción */}
                <View style={styles.confirmToggleButtonsRow}>
                  <Pressable
                    onPress={() => setConfirmToggleGuest(null)}
                    style={styles.confirmToggleCancelBtn}>
                    <ThemedText style={styles.confirmToggleCancelText}>Cancelar</ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      const target = confirmToggleGuest;
                      setConfirmToggleGuest(null);
                      toggleCheckIn(target);
                    }}
                    style={styles.confirmToggleSubmitBtn}>
                    <LinearGradient
                      colors={
                        confirmToggleGuest.status === 'attended'
                          ? ['#ea580c', '#c2410c']
                          : ['#059669', '#10b981']
                      }
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.confirmToggleSubmitGradient}>
                      <ThemedText style={styles.confirmToggleSubmitText}>
                        {confirmToggleGuest.status === 'attended'
                          ? '🔴 Revertir Ingreso'
                          : '🟢 Registrar Ingreso'}
                      </ThemedText>
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Modal de Ticket / Pase Digital del Invitado */}
      <Modal visible={Boolean(ticketModalGuest)} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.ticketCardModal}>
            <LinearGradient
              colors={['#FF0055', '#E61E50', '#F97316']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.ticketHeader}>
              <ThemedText style={styles.ticketBadgeIcon}>💍 WEDDING CHECK</ThemedText>
              <ThemedText style={styles.ticketEventTitle}>{currentEvent ? currentEvent.title : 'Boda'}</ThemedText>
            </LinearGradient>

            {ticketModalGuest && (
              <View style={styles.ticketBody}>
                <ThemedText style={styles.ticketGuestName}>{ticketModalGuest.name}</ThemedText>
                <ThemedText style={styles.ticketQrBadge}>{ticketModalGuest.qr_code}</ThemedText>

                <View style={styles.ticketGrid}>
                  <View style={styles.ticketGridItem}>
                    <ThemedText style={styles.ticketGridLabel}>🪑 MESA ASIGNADA</ThemedText>
                    <ThemedText style={styles.ticketGridValProminent}>
                      {ticketModalGuest.table_number || 'Sin Mesa'}
                    </ThemedText>
                    <Pressable
                      onPress={() => {
                        const target = ticketModalGuest;
                        setTicketModalGuest(null);
                        setReassignGuest(target);
                        setNewTableInput(target.table_number || '');
                      }}
                      style={styles.reassignBtnPill}>
                      <ThemedText style={styles.reassignBtnPillText}>✏️ Cambiar Mesa</ThemedText>
                    </Pressable>
                  </View>

                  <View style={styles.ticketGridItem}>
                    <ThemedText style={styles.ticketGridLabel}>🎟️ PASES</ThemedText>
                    <ThemedText style={styles.ticketGridVal}>
                      {ticketModalGuest.confirmed_passes || ticketModalGuest.passes} Personas
                    </ThemedText>
                  </View>
                </View>

                {ticketModalGuest.dietary_restrictions ? (
                  <View style={styles.ticketDietBox}>
                    <ThemedText style={styles.ticketDietLabel}>🥛 Preferencia Alimentaria:</ThemedText>
                    <ThemedText style={styles.ticketDietVal}>{ticketModalGuest.dietary_restrictions}</ThemedText>
                  </View>
                ) : null}

                <View style={styles.ticketStatusBox}>
                  <ThemedText style={styles.ticketStatusText}>
                    Estado: {ticketModalGuest.status === 'attended' ? '✅ INGRESÓ AL EVENTO' : '📋 ASISTENCIA CONFIRMADA'}
                  </ThemedText>
                </View>
              </View>
            )}

            <Button
              title="Cerrar Pase"
              onPress={() => setTicketModalGuest(null)}
              style={styles.ticketCloseBtn}
            />
          </View>
        </View>
      </Modal>

      {/* Modal para Reasignación Rápida de Mesa */}
      <Modal visible={Boolean(reassignGuest)} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <ThemedText style={styles.modalHeaderTitle}>🪑 Reasignar Mesa</ThemedText>
                <ThemedText style={styles.modalHeaderSub}>{reassignGuest?.name}</ThemedText>
              </View>
              <Pressable onPress={() => setReassignGuest(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </Pressable>
            </View>

            <View style={styles.modalBody}>
              <ThemedText style={styles.inputLabel}>Mesa Actual:</ThemedText>
              <View style={styles.currentTableBox}>
                <ThemedText style={styles.currentTableText}>
                  {reassignGuest?.table_number || 'Sin Mesa Asignada'}
                </ThemedText>
              </View>

              <ThemedText style={styles.inputLabel}>Seleccionar Mesa Existente:</ThemedText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableChipsRow}>
                {existingTableNames.map((tbl) => (
                  <Pressable
                    key={tbl}
                    onPress={() => setNewTableInput(tbl)}
                    style={[
                      styles.tableChip,
                      newTableInput === tbl && styles.tableChipActive,
                    ]}>
                    <ThemedText
                      style={[
                        styles.tableChipText,
                        newTableInput === tbl && styles.tableChipTextActive,
                      ]}>
                      {tbl}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>

              <ThemedText style={styles.inputLabel}>O escribir nueva mesa:</ThemedText>
              <TextInput
                style={styles.textInput}
                placeholder="Ej: Mesa 12 / Mesa Terraza"
                placeholderTextColor="#94a3b8"
                value={newTableInput}
                onChangeText={setNewTableInput}
              />
            </View>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setReassignGuest(null)} style={styles.cancelBtn}>
                <ThemedText style={styles.cancelBtnText}>Cancelar</ThemedText>
              </Pressable>

              <Pressable
                disabled={savingTable}
                onPress={handleSaveTableReassignment}
                style={styles.saveBtn}>
                <LinearGradient
                  colors={['#FF0055', '#E61E50']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveBtnGradient}>
                  {savingTable ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <ThemedText style={styles.saveBtnText}>Guardar Mesa</ThemedText>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para Alta Express de Invitados en Puerta */}
      <Modal visible={expressModalVisible} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View>
                <ThemedText style={styles.modalHeaderTitle}>➕ Alta Express de Invitado</ThemedText>
                <ThemedText style={styles.modalHeaderSub}>Registrar en puerta sin invitación previa</ThemedText>
              </View>
              <Pressable onPress={() => setExpressModalVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody}>
              <View style={styles.inputGroup}>
                <ThemedText style={styles.inputLabel}>Nombre y Apellido *</ThemedText>
                <TextInput
                  style={styles.textInput}
                  placeholder="Ej: Laura & Marcelo Benítez"
                  placeholderTextColor="#94a3b8"
                  value={expressName}
                  onChangeText={setExpressName}
                />
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.inputLabel}>Cantidad de Pases / Personas</ThemedText>
                <View style={styles.counterRow}>
                  <Pressable
                    onPress={() => setExpressPasses((p) => Math.max(1, p - 1))}
                    style={styles.counterBtn}>
                    <ThemedText style={styles.counterBtnText}>-</ThemedText>
                  </Pressable>
                  <ThemedText style={styles.counterVal}>{expressPasses} pases</ThemedText>
                  <Pressable
                    onPress={() => setExpressPasses((p) => p + 1)}
                    style={styles.counterBtn}>
                    <ThemedText style={styles.counterBtnText}>+</ThemedText>
                  </Pressable>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.inputLabel}>Mesa Asignada</ThemedText>
                <TextInput
                  style={styles.textInput}
                  placeholder="Ej: Mesa 4 / Mesa Jóvenes"
                  placeholderTextColor="#94a3b8"
                  value={expressTable}
                  onChangeText={setExpressTable}
                />
                {existingTableNames.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tableChipsRowSmall}>
                    {existingTableNames.slice(0, 6).map((tbl) => (
                      <Pressable
                        key={tbl}
                        onPress={() => setExpressTable(tbl)}
                        style={[
                          styles.tableChipSmall,
                          expressTable === tbl && styles.tableChipSmallActive,
                        ]}>
                        <ThemedText
                          style={[
                            styles.tableChipSmallText,
                            expressTable === tbl && styles.tableChipSmallTextActive,
                          ]}>
                          {tbl}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </View>

              <View style={styles.inputGroup}>
                <ThemedText style={styles.inputLabel}>Preferencia de Menú / Dieta (Opcional)</ThemedText>
                <TextInput
                  style={styles.textInput}
                  placeholder="Ej: Celíaco / Sin Lactosa / Vegetariano"
                  placeholderTextColor="#94a3b8"
                  value={expressDiet}
                  onChangeText={setExpressDiet}
                />
              </View>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.switchTitle}>¿Acreditar e ingresar ahora?</ThemedText>
                  <ThemedText style={styles.switchSub}>Marca la hora de ingreso en el salón de inmediato</ThemedText>
                </View>
                <Switch
                  value={expressAutoCheckIn}
                  onValueChange={setExpressAutoCheckIn}
                  trackColor={{ false: '#cbd5e1', true: '#fecdd3' }}
                  thumbColor={expressAutoCheckIn ? '#e11d48' : '#94a3b8'}
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setExpressModalVisible(false)} style={styles.cancelBtn}>
                <ThemedText style={styles.cancelBtnText}>Cancelar</ThemedText>
              </Pressable>

              <Pressable
                disabled={savingExpress}
                onPress={handleCreateExpressGuest}
                style={styles.saveBtn}>
                <LinearGradient
                  colors={['#10b981', '#059669']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveBtnGradient}>
                  {savingExpress ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <ThemedText style={styles.saveBtnText}>Registrar Invitado</ThemedText>
                  )}
                </LinearGradient>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
  todayHeaderBadge: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  todayHeaderBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#e11d48',
    letterSpacing: 0.8,
  },
  readOnlyHeaderBadge: {
    backgroundColor: '#fef3c7',
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
    marginBottom: Spacing.four,
    gap: 10,
  },
  readOnlyNoticeContent: {
    flex: 1,
    gap: 2,
  },
  pendingSyncBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: Spacing.four,
    gap: 10,
  },
  pendingSyncTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1e40af',
  },
  pendingSyncDesc: {
    fontSize: 12,
    color: '#1e3a8a',
    lineHeight: 16,
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
  locationText: {
    fontSize: 12,
    fontWeight: '500',
  },
  logoutBadge: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  logoutText: {
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

  /* Header Actions */
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
  },
  qrScanBadge: {
    backgroundColor: '#e11d48',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  qrScanText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
  },

  /* Hero QR Button */
  heroQrButton: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  heroQrGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: 14,
    gap: 12,
  },
  heroQrIcon: {
    fontSize: 26,
  },
  heroQrCol: {
    flex: 1,
    gap: 2,
  },
  heroQrTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  heroQrSub: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
  },
  heroQrArrow: {
    fontSize: 18,
    fontWeight: '900',
    color: '#ffffff',
  },

  /* Métricas de Recepción */
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
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
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
    marginTop: 2,
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
  statNumberDark: {
    color: '#0f172a',
    fontSize: 22,
    fontWeight: '900',
  },
  statNumberAmber: {
    color: '#d97706',
    fontSize: 22,
    fontWeight: '900',
  },
  statLabelDark: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statSubDark: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },

  /* Barra de Progreso y Catering */
  progressCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  progressSubText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  progressBarTrack: {
    height: 12,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 6,
  },
  cateringBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
    marginTop: 4,
  },
  cateringHeaderCol: {
    gap: 2,
  },
  cateringBoxTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#0f172a',
  },
  cateringBoxSub: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  cateringBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  cateringBadgeStandard: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cateringBadgeStandardText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
  },
  cateringBadgeSpecial: {
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  cateringBadgeSpecialText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#c2410c',
  },

  /* Toggle de Vistas Internas */
  modeToggleRow: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#e2e8f0',
    padding: 4,
    borderRadius: 14,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  toggleBtnTextActive: {
    color: '#0f172a',
    fontWeight: '900',
  },

  /* Búsqueda y Filtros */
  searchSection: {
    gap: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
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
    fontWeight: '600',
  },
  clearBtn: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
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
  pillActiveAttended: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
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
  guestCardAttended: {
    borderColor: '#10b981',
    backgroundColor: '#f0fdf4',
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
  attendedBadge: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  attendedBadgeText: {
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  confirmedBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  confirmedBadgeText: {
    color: '#0369a1',
    fontSize: 10,
    fontWeight: '800',
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tableBadgeProminent: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  tableTextProminent: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
  },
  passesBadgeSubtle: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  passesTextSubtle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  dietBox: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  dietText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400e',
  },
  notesText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  checkInBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 100,
  },
  checkInBtnPending: {
    backgroundColor: '#e11d48',
  },
  checkInBtnActive: {
    backgroundColor: '#10b981',
  },
  checkInBtnReadOnly: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  checkInBtnTextReadOnly: {
    color: '#64748b',
    fontWeight: '700',
  },
  checkInBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  emptyBox: {
    padding: Spacing.five,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
  },

  /* Vista por Mesas */
  tablesContainer: {
    gap: 14,
  },
  tableCardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: Spacing.four,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  tableCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
  },
  tableTitleCol: {
    gap: 2,
  },
  tableCardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  tableCardSub: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  tableCountBadge: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  tableCountText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0284c7',
  },
  tableGuestList: {
    gap: 8,
  },
  tableGuestRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  tableGuestName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
  },
  tableGuestDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tableDietText: {
    fontSize: 11,
    color: '#d97706',
    fontWeight: '700',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  tablePassesText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },

  /* Modales */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.four,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: Spacing.five,
    width: '100%',
    maxWidth: 440,
    gap: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  modalInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modalInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    fontSize: 15,
    fontWeight: '700',
  },
  modalValidateBtn: {
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  quickScanLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    marginTop: 4,
  },
  quickScanRow: {
    gap: 6,
  },
  quickScanChip: {
    backgroundColor: '#f1f5f9',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickScanChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#e11d48',
  },
  quickScanChipWarning: {
    backgroundColor: '#fff7ed',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  quickScanChipWarningText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#c2410c',
  },
  scanSuccessResultCard: {
    padding: Spacing.four,
    borderRadius: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  successBadgeTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: '#047857',
    letterSpacing: 0.5,
  },
  successGuestName: {
    fontSize: 18,
    fontWeight: '900',
    color: '#064e3b',
  },
  successDetailRow: {
    flexDirection: 'row',
    gap: 16,
  },
  successDetailText: {
    fontSize: 13,
    color: '#065f46',
  },
  successDietText: {
    fontSize: 12,
    color: '#b45309',
    fontWeight: '700',
  },
  timestampText: {
    fontSize: 11,
    color: '#047857',
    fontWeight: '600',
    marginTop: 4,
  },
  modalCloseBtn: {
    marginTop: 6,
  },

  /* Ticket Digital */
  ticketCardModal: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 380,
  },
  ticketHeader: {
    padding: Spacing.five,
    alignItems: 'center',
    gap: 4,
  },
  ticketBadgeIcon: {
    fontSize: 12,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
  },
  ticketEventTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
  },
  ticketBody: {
    padding: Spacing.five,
    alignItems: 'center',
    gap: 14,
  },
  ticketGuestName: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
    textAlign: 'center',
  },
  ticketQrBadge: {
    backgroundColor: '#f1f5f9',
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
  },
  ticketGrid: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  ticketGridItem: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  ticketGridLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  ticketGridValProminent: {
    fontSize: 18,
    fontWeight: '900',
    color: '#e11d48',
    marginTop: 4,
  },
  ticketGridVal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  ticketDietBox: {
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  ticketDietLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#c2410c',
  },
  ticketDietVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9a3412',
    marginTop: 2,
  },
  ticketStatusBox: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    width: '100%',
    alignItems: 'center',
  },
  ticketStatusText: {
    fontSize: 12,
    fontWeight: '900',
    color: '#15803d',
  },
  ticketCloseBtn: {
    margin: Spacing.four,
    marginTop: 0,
  },
  fullScreenCameraContainer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  cameraOverlaySafeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cameraTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 24 : 8,
  },
  cameraPromptText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  cameraCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  cameraCloseBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  cameraReticleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraReticleBox: {
    width: 250,
    height: 250,
    position: 'relative',
  },
  cornerBracket: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderColor: '#ffffff',
  },
  cornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 18,
  },
  cornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 18,
  },
  cornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 18,
  },
  cornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 18,
  },
  cameraBottomPanel: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  cameraActionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  floatingCircleBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  floatingCircleBtnActive: {
    backgroundColor: 'rgba(225, 29, 72, 0.8)',
    borderColor: '#e11d48',
  },
  floatingBtnIcon: {
    fontSize: 22,
  },
  quickScanRowInline: {
    flexDirection: 'row',
    gap: 6,
  },
  quickScanChipGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  quickScanChipGlassText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffffff',
  },
  quickScanChipGlassWarning: {
    backgroundColor: 'rgba(234, 88, 12, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(251, 146, 60, 0.6)',
  },
  quickScanChipGlassWarningText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#ffedd5',
  },
  cameraCenterContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#0f172a',
  },
  permissionText: {
    fontSize: 12,
    textAlign: 'center',
    color: '#cbd5e1',
    fontWeight: '600',
  },

  /* Modal Pop-Up de Resultado: Invitado Registrado */
  registeredModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 400,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  registeredHeader: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: 8,
  },
  registeredBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  registeredBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
  },
  registeredGuestName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  registeredQrCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#d1fae5',
  },
  registeredBody: {
    padding: Spacing.five,
    gap: 14,
  },
  registeredGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  registeredGridItemProminent: {
    flex: 1.2,
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  registeredGridItem: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  registeredGridLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  registeredGridValProminent: {
    fontSize: 17,
    fontWeight: '900',
    color: '#047857',
    marginTop: 4,
    textAlign: 'center',
  },
  registeredGridVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
    textAlign: 'center',
  },
  registeredDietBox: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    gap: 4,
  },
  registeredDietBoxActive: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
  },
  registeredDietBoxStandard: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  registeredDietHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  registeredDietIcon: {
    fontSize: 16,
  },
  registeredDietTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  registeredDietVal: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  registeredDietValActive: {
    color: '#c2410c',
  },
  registeredDietValStandard: {
    color: '#15803d',
  },
  registeredTimeBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
  },
  registeredTimeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  registeredNextBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 4,
  },
  registeredNextBtnGradient: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  registeredNextBtnText: {
    fontSize: 14,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.8,
  },

  /* Modal Pop-Up de Resultado: Pase Ya Utilizado */
  alreadyUsedModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 400,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  alreadyUsedHeader: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: 8,
  },
  alreadyUsedBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  alreadyUsedBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
  },
  alreadyUsedGuestName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  alreadyUsedQrCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffedd5',
  },
  alreadyUsedBody: {
    padding: Spacing.five,
    gap: 14,
  },
  alreadyUsedWarningBanner: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alreadyUsedWarningIcon: {
    fontSize: 20,
  },
  alreadyUsedWarningText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: '#c2410c',
    lineHeight: 17,
  },
  alreadyUsedGridItemProminent: {
    flex: 1.2,
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
  },
  alreadyUsedGridValProminent: {
    fontSize: 17,
    fontWeight: '900',
    color: '#ea580c',
    marginTop: 4,
    textAlign: 'center',
  },
  alreadyUsedTimeBox: {
    backgroundColor: '#fff7ed',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ffedd5',
  },
  alreadyUsedTimeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#c2410c',
  },
  alreadyUsedNextBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 4,
  },

  /* Modal Pop-Up de Confirmación de Cambio Manual */
  confirmToggleModalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
    width: '100%',
    maxWidth: 400,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  confirmToggleHeader: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.five,
    alignItems: 'center',
    gap: 8,
  },
  confirmToggleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
  },
  confirmToggleBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
  },
  confirmToggleGuestName: {
    fontSize: 22,
    fontWeight: '900',
    color: '#ffffff',
    textAlign: 'center',
  },
  confirmToggleBody: {
    padding: Spacing.five,
    gap: 16,
  },
  confirmToggleWarningBox: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  confirmToggleWarningIcon: {
    fontSize: 22,
  },
  confirmToggleWarningText: {
    flex: 1,
    fontSize: 13,
    color: '#c2410c',
    lineHeight: 18,
  },
  confirmToggleDetailsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  confirmToggleGridItem: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  confirmToggleQuestionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    textAlign: 'center',
    lineHeight: 20,
  },
  confirmToggleButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  confirmToggleCancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  confirmToggleCancelText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#475569',
  },
  confirmToggleSubmitBtn: {
    flex: 1.3,
    borderRadius: 14,
    overflow: 'hidden',
  },
  confirmToggleSubmitGradient: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmToggleSubmitText: {
    fontSize: 13,
    fontWeight: '900',
    color: '#ffffff',
  },

  /* Botón Compartir Cocina */
  kitchenShareBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
  },
  kitchenShareGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  kitchenShareTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  /* Búsqueda y Alta Express */
  searchRowWithExpress: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: 10,
  },
  expressBtn: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#e11d48',
    paddingHorizontal: 14,
    borderRadius: 14,
    shadowColor: '#e11d48',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  expressBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },

  /* VIP Badges & Protocolo */
  vipListBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  vipListBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.5,
  },
  vipScanBanner: {
    backgroundColor: '#fffbeb',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    gap: 4,
    alignItems: 'center',
  },
  vipScanBadgeRow: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  vipScanBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.8,
  },
  vipScanTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#92400e',
    textAlign: 'center',
  },
  vipScanNotes: {
    fontSize: 12,
    color: '#78350f',
    textAlign: 'center',
    fontWeight: '600',
  },

  /* Reasignación de Mesa */
  tableBadgeProminentClickable: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  reassignBtnPill: {
    backgroundColor: '#fff1f2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#fecdd3',
    alignSelf: 'center',
  },
  reassignBtnPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#e11d48',
  },
  currentTableBox: {
    backgroundColor: '#f1f5f9',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  currentTableText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#0f172a',
  },
  tableChipsRow: {
    gap: 8,
    paddingVertical: 4,
  },
  tableChip: {
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  tableChipActive: {
    backgroundColor: '#e11d48',
    borderColor: '#be123c',
  },
  tableChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
  },
  tableChipTextActive: {
    color: '#ffffff',
  },
  tableChipsRowSmall: {
    gap: 6,
    marginTop: 4,
  },
  tableChipSmall: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tableChipSmallActive: {
    backgroundColor: '#e11d48',
    borderColor: '#be123c',
  },
  tableChipSmallText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  tableChipSmallTextActive: {
    color: '#ffffff',
  },

  /* Counter Row para Express Passes */
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  counterBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  counterBtnText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0f172a',
  },
  counterVal: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
    minWidth: 70,
    textAlign: 'center',
  },

  /* Switch Row */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff1f2',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#fecdd3',
    gap: 12,
  },
  switchTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#9f1239',
  },
  switchSub: {
    fontSize: 11,
    color: '#e11d48',
  },
  modalHeaderSub: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 20,
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalHeaderTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
  },
  modalBody: {
    gap: 12,
    paddingBottom: 8,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textInput: {
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 16,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
  },
  saveBtn: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  saveBtnGradient: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
  },
});
