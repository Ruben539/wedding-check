import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { getAuthHeaders, useAuth } from '@/context/auth-context';
import { useEvent } from '@/context/event-context';
import { fetchWithTimeout, useSync } from '@/context/sync-context';
import { APP_URL, SKIP_EVENT_DATE_CHECK } from '@/env';
import { useTheme } from '@/hooks/use-theme';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { hasInternet } from '@/utils/network';
import { companionsMatch, getGuestPasses, getMembersAway, isGuestConfirmed } from '@/utils/guests';
import { useLiveGuests, type Guest } from '@/context/guests-context';
import { GuestHistoryModal } from '@/components/guest-history-modal';
import { DoorGuestCard } from '@/features/reception/door-guest-card';
import { formatDisplayTime, getVipBadgeText, isVipGuest, vibrateScan } from '@/features/reception/helpers';
import { ReceptionSummary } from '@/features/reception/reception-summary';
import { ReceptionTablesView } from '@/features/reception/reception-tables-view';
import { styles } from '@/features/reception/reception.styles';

type GuestItem = Guest;

export default function DoorReceptionScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const { events, selectedEvent, selectedEventId, refreshEvents } = useEvent();
  const { pendingOps, isSyncing, sendOrQueue, flush } = useSync();
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

  // Shared guest list; refreshes every 20s while this screen is open so several door devices stay in sync
  const { guests, setGuests, refreshGuests } = useLiveGuests();
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
  const [scanResult, setScanResult] = useState<{ guest: GuestItem; timestamp: string; entering?: number; inside?: number; group?: number; names?: string[] } | null>(null);
  // Group invitation scanned: how many of them are entering now
  const [peoplePrompt, setPeoplePrompt] = useState<{
    token: string;
    guest: GuestItem;
    group: number;
    inside: number;
    remaining: number;
    // Holder + named companions (who is outside can be ticked); unnamed people are only counted
    people: { key: string; name: string; inside: boolean; unnamed?: boolean }[];
    confirmed: number;
  } | null>(null);
  const [promptSelected, setPromptSelected] = useState<string[]>([]);
  const [promptExtra, setPromptExtra] = useState<number>(0);
  const [alreadyUsedResult, setAlreadyUsedResult] = useState<{ guest: GuestItem; timestamp?: string } | null>(null);
  const [confirmToggleGuest, setConfirmToggleGuest] = useState<GuestItem | null>(null);
  const [ticketModalGuest, setTicketModalGuest] = useState<GuestItem | null>(null);
  const [historyGuest, setHistoryGuest] = useState<GuestItem | null>(null);

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

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshEvents();
    await refreshGuests();
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
        // expected_status: the server rejects the change if another device already changed this guest
        body: { status: newStatus, expected_status: guest.status },
        guestId: guest.id,
        patch: { status: newStatus, attended_at: newStatus === 'attended' ? timestamp : null },
      });
      if (result.status === 'rejected') {
        const json = await result.res.json().catch(() => null);
        if (result.res.status === 409) {
          Alert.alert('Ya actualizado en otra puerta', json?.message || `"${guest.name}" fue modificado desde otro dispositivo.`);
        } else {
          Alert.alert('No se pudo guardar', json?.message || `El servidor rechazó el cambio de estado de "${guest.name}".`);
        }
        refreshGuests();
      }
    } finally {
      setUpdatingGuestId(null);
    }
  };

  // Escanear / Validar QR con API Backend
  const handleScanQR = async (codeToScan?: string, people?: number, members?: string[]) => {
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
      if (!(await hasInternet())) {
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
          // Groups: the server asks how many are entering (ask_people) and the same QR serves the rest later
          partial: true,
          ...(people ? { people } : {}),
          ...(members && members.length ? { members } : {}),
        }),
      });
      json = await res.json().catch(() => ({}));
    } catch {
      processLocally();
      return;
    }

    if (res.ok && json.status === 'ask_people') {
      vibrateScan('warning');
      setPeoplePrompt({
        token: cleanToken,
        guest: json.guest || foundAny,
        group: Number(json.group) || 1,
        inside: Number(json.inside) || 0,
        remaining: Number(json.remaining) || 1,
        people: Array.isArray(json.people) ? json.people : [],
        confirmed: Number(json.confirmed) || 0,
      });
      setPromptSelected([]);
      setPromptExtra(0);
    } else if (res.ok && json.success) {
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
        prev.map((g) =>
          String(g.id) === String(updatedGuest.id)
            ? { ...g, status: 'attended', attended_at: g.attended_at || timestamp, attended_people: json.inside ?? updatedGuest.attended_people }
            : g
        )
      );
      setScanResult({
        guest: { ...updatedGuest, status: 'attended', attended_at: timestamp },
        timestamp: timestamp,
        entering: json.entering,
        inside: json.inside,
        group: json.group,
        names: Array.isArray(json.entering_names) ? json.entering_names : [],
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
        refreshGuests();
      } else {
        // Recargar para obtener el ID real asignado por el servidor
        if (result?.status === 'sent') refreshGuests();
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
        refreshGuests();
      } else {
        Alert.alert(
          'Mesa Reasignada',
          `La mesa de "${guestName}" fue actualizada a: ${targetTable}${result?.status === 'queued' ? '\n\n📶 Sin conexión: se enviará al servidor cuando vuelva la señal.' : ''}`
        );
      }
    }
  };

  // Protocolo y Alertas VIP

  const handleOpenReassign = useCallback((guest: GuestItem) => {
    setReassignGuest(guest);
    setNewTableInput(guest.table_number || '');
  }, []);

  const handleCheckInPress = useCallback((guest: GuestItem) => {
    if (!isEventToday) {
      Alert.alert(
        'Modo Solo Lectura',
        `No se puede marcar el ingreso porque el evento es el ${formattedEventDate || 'fecha programada'}. Las acciones de acreditación se habilitan el día del evento.`,
        [{ text: 'Entendido' }]
      );
      return;
    }
    setConfirmToggleGuest(guest);
  }, [isEventToday, formattedEventDate]);

  const renderDoorGuestItem = useCallback(
    ({ item }: { item: GuestItem }) => (
      <DoorGuestCard
        guest={item}
        isUpdating={updatingGuestId === item.id}
        isEventToday={isEventToday}
        onOpen={setTicketModalGuest}
        onReassignTable={handleOpenReassign}
        onCheckInPress={handleCheckInPress}
      />
    ),
    [updatingGuestId, isEventToday, handleOpenReassign, handleCheckInPress]
  );

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

  // Lista de invitados que CONFIRMARON y ASISTIRÁN al evento
  const preConfirmedGuests = useMemo(() => {
    // Same rule as the Invitados screen, so both show the same number of confirmed guests
    return guests.filter((g) => isGuestConfirmed(g));
  }, [guests]);

  // Filtrado en tiempo real en la lista de recepción
  const filteredGuests = useMemo(() => {
    return preConfirmedGuests.filter((g) => {
      const matchQuery =
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.table_number && g.table_number.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (g.qr_code && g.qr_code.toLowerCase().includes(searchQuery.toLowerCase())) ||
        g.phone.includes(searchQuery) ||
        companionsMatch(g, searchQuery);

      if (!matchQuery) return false;

      if (filterStatus === 'attended') return g.status === 'attended';
      if (filterStatus === 'pending') return g.status !== 'attended';
      return true;
    });
  }, [preConfirmedGuests, searchQuery, filterStatus]);

  // Agrupamiento por Mesas (Exclusivo invitados confirmados)
  const tableGroups = useMemo(() => {
    const groups: { [key: string]: GuestItem[] } = {};
    const add = (tableKey: string, item: GuestItem) => {
      if (!groups[tableKey]) groups[tableKey] = [];
      groups[tableKey].push(item);
    };
    preConfirmedGuests.forEach((g) => {
      // Companions seated at another table appear there (and take one seat less from the group)
      const away = getMembersAway(g);
      add(g.table_number || 'Sin Mesa Asignada', away.length ? { ...g, confirmed_passes: Math.max(1, getGuestPasses(g) - away.length) } : g);
      away.forEach((m) =>
        add(m.table_number as string, {
          id: `m${m.id}`,
          name: `${m.name} (acompañante de ${g.name})`,
          phone: '',
          passes: 1,
          confirmed_passes: 1,
          status: m.attended_at ? 'attended' : 'confirmed',
          table_number: m.table_number,
        })
      );
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
      // Groups that came in parts count only who is already inside
      .reduce((acc, g) => acc + (Number(g.attended_people) > 0 ? Number(g.attended_people) : getGuestPasses(g)), 0);
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
                <View style={styles.liveDot} />
                <ThemedText style={styles.todayHeaderBadgeText}>
                  EVENTO DE HOY · {getTodayFormattedLabel()}
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.todayHeaderBadge, styles.readOnlyHeaderBadge]}>
                <Ionicons name="lock-closed" size={11} color="#b45309" />
                <ThemedText style={styles.readOnlyHeaderBadgeText}>
                  MODO CONSULTA · {formattedEventDate || currentEvent?.event_date}
                </ThemedText>
              </View>
            )}
            <ThemedText type="subtitle" style={styles.headerTitle}>
              {currentEvent ? currentEvent.title : 'Recepción de Invitados'}
            </ThemedText>
            {currentEvent?.location ? (
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={14} color="#94a3b8" />
                <ThemedText style={styles.locationText} themeColor="textSecondary" numberOfLines={1}>
                  {currentEvent.location}
                </ThemedText>
              </View>
            ) : null}
          </View>
        </View>

        {viewMode === 'tables' ? (
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
                colors={isEventToday ? ['#e11d48', '#f43f5e', '#fb923c'] : ['#64748b', '#475569', '#334155']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroQrGradient}>
                <View style={styles.heroQrIconCircle}>
                  <Ionicons name={isEventToday ? 'qr-code-outline' : 'lock-closed-outline'} size={28} color="#ffffff" />
                </View>
                <View style={styles.heroQrCol}>
                  <ThemedText style={styles.heroQrTitle}>
                    {isEventToday ? 'Escanear código QR' : 'Acreditación bloqueada'}
                  </ThemedText>
                  <ThemedText style={styles.heroQrSub}>
                    {isEventToday
                      ? 'Validar y acreditar ingreso de invitados'
                      : `Habilitado únicamente el día del evento (${formattedEventDate})`}
                  </ThemedText>
                </View>
                <Ionicons name={isEventToday ? 'chevron-forward' : 'information-circle-outline'} size={24} color="#ffffff" />
              </LinearGradient>
            </Pressable>

            <ReceptionSummary stats={stats} onShareKitchenReport={handleShareKitchenReport} />

            {/* Conmutador de Vistas Internas: Lista vs Invitados por mesa */}
            <View style={styles.modeToggleRow}>
              <Pressable
                onPress={() => setViewMode('list')}
                style={styles.toggleBtn}>
                <ThemedText style={styles.toggleBtnText}>
                  Lista de puerta ({filteredGuests.length})
                </ThemedText>
              </Pressable>

              <Pressable
                onPress={() => setViewMode('tables')}
                style={[styles.toggleBtn, styles.toggleBtnActive]}>
                <ThemedText style={[styles.toggleBtnText, styles.toggleBtnTextActive]}>
                  Por mesa ({Object.keys(tableGroups).length})
                </ThemedText>
              </Pressable>
            </View>

            <ReceptionTablesView tableGroups={tableGroups} />
          </ScrollView>
        ) : (
          <FlatList
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            data={filteredGuests}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderDoorGuestItem}
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
                    colors={isEventToday ? ['#e11d48', '#f43f5e', '#fb923c'] : ['#64748b', '#475569', '#334155']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.heroQrGradient}>
                    <View style={styles.heroQrIconCircle}>
                      <Ionicons name={isEventToday ? 'qr-code-outline' : 'lock-closed-outline'} size={28} color="#ffffff" />
                    </View>
                    <View style={styles.heroQrCol}>
                      <ThemedText style={styles.heroQrTitle}>
                        {isEventToday ? 'Escanear código QR' : 'Acreditación bloqueada'}
                      </ThemedText>
                      <ThemedText style={styles.heroQrSub}>
                        {isEventToday
                          ? 'Validar y acreditar ingreso de invitados'
                          : `Habilitado únicamente el día del evento (${formattedEventDate})`}
                      </ThemedText>
                    </View>
                    <Ionicons name={isEventToday ? 'chevron-forward' : 'information-circle-outline'} size={24} color="#ffffff" />
                  </LinearGradient>
                </Pressable>

                <ReceptionSummary stats={stats} onShareKitchenReport={handleShareKitchenReport} />

                {/* Conmutador de Vistas Internas: Lista vs Invitados por mesa */}
                <View style={styles.modeToggleRow}>
                  <Pressable
                    onPress={() => setViewMode('list')}
                    style={[styles.toggleBtn, styles.toggleBtnActive]}>
                    <ThemedText style={[styles.toggleBtnText, styles.toggleBtnTextActive]}>
                      Lista de puerta ({filteredGuests.length})
                    </ThemedText>
                  </Pressable>

                  <Pressable
                    onPress={() => setViewMode('tables')}
                    style={styles.toggleBtn}>
                    <ThemedText style={styles.toggleBtnText}>
                      Por mesa ({Object.keys(tableGroups).length})
                    </ThemedText>
                  </Pressable>
                </View>

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
                      <Ionicons name="person-add-outline" size={18} color="#ffffff" />
                      <ThemedText style={styles.expressBtnText}>Express</ThemedText>
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
                        ⏳ Por llegar ({stats.pendingEntrance})
                      </ThemedText>
                    </Pressable>
                  </ScrollView>
                </View>

                {/* Título de Sección de Acreditación */}
                <View style={styles.guestListSection}>
                  <ThemedText style={[styles.sectionTitle, { marginBottom: 10 }]}>
                    ACREDITACIÓN EN PUERTA ({filteredGuests.length})
                  </ThemedText>
                </View>
              </>
            }
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                <ThemedText style={styles.emptyIcon}>🔍</ThemedText>
                <ThemedText style={styles.emptyText}>
                  No se encontraron invitados con el filtro o búsqueda actual.
                </ThemedText>
              </View>
            }
          />
        )}
      </SafeAreaView>

      {/* Modal de Escáner QR Estilo Cámara Nativa de Smartphone */}
      {scannerVisible && (
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
      )}

      {/* Invitación de grupo: cuántas personas ingresan ahora (el resto puede entrar después con el mismo QR) */}
      <Modal visible={Boolean(peoplePrompt)} animationType="fade" transparent statusBarTranslucent>
        <View style={styles.modalOverlay}>
          <View style={[styles.registeredModalCard, { padding: 20 }]}>
            <ThemedText style={{ fontSize: 13, fontWeight: '800', color: '#059669' }}>👥 ASISTENCIA DEL GRUPO</ThemedText>
            <ThemedText style={{ fontSize: 20, fontWeight: '900', color: '#0f172a', marginTop: 4 }} numberOfLines={2}>
              {peoplePrompt?.guest?.name}
            </ThemedText>
            <ThemedText style={{ fontSize: 13, color: '#475569', marginTop: 6 }}>
              {peoplePrompt && peoplePrompt.inside > 0
                ? `Ya ingresaron ${peoplePrompt.inside} de ${peoplePrompt.group}. Marcá quiénes llegaron ahora.`
                : `Invitación para ${peoplePrompt?.group} personas. Marcá quiénes llegaron.`}
              {peoplePrompt && peoplePrompt.confirmed > 0 && peoplePrompt.confirmed < peoplePrompt.group
                ? `\n(Por WhatsApp confirmaron ${peoplePrompt.confirmed} de ${peoplePrompt.group})`
                : ''}
            </ThemedText>
            {peoplePrompt && peoplePrompt.people.length > 1 ? (
              (() => {
                // Named group: tick who is entering; people without a name are added with the counter
                const outside = peoplePrompt.people.filter((p) => !p.inside);
                const extraMax = Math.max(0, peoplePrompt.remaining - outside.length);
                const total = promptSelected.length + promptExtra;
                return (
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 8 }}>
                    {peoplePrompt.people.map((p) => {
                      const checked = promptSelected.includes(p.key);
                      return (
                        <Pressable
                          key={p.key}
                          disabled={p.inside}
                          onPress={() =>
                            setPromptSelected((prev) => (checked ? prev.filter((k) => k !== p.key) : [...prev, p.key]))
                          }
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 10,
                            padding: 12,
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: checked ? '#10b981' : '#e2e8f0',
                            backgroundColor: p.inside ? '#f1f5f9' : checked ? '#ecfdf5' : '#ffffff',
                          }}>
                          <Ionicons
                            name={p.inside ? 'checkmark-done' : checked ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={p.inside ? '#94a3b8' : '#10b981'}
                          />
                          <ThemedText style={{ flex: 1, fontSize: 14, fontWeight: '700', color: p.inside ? '#94a3b8' : '#0f172a', fontStyle: p.unnamed ? 'italic' : 'normal' }}>
                            {p.name}{p.key === 'holder' ? ' (titular)' : ''}
                          </ThemedText>
                          {p.inside ? <ThemedText style={{ fontSize: 11, color: '#94a3b8' }}>ya ingresó</ThemedText> : null}
                        </Pressable>
                      );
                    })}
                    </ScrollView>
                    {extraMax > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10 }}>
                        <ThemedText style={{ fontSize: 13, color: '#475569' }}>Otros sin nombre</ThemedText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Pressable onPress={() => setPromptExtra((n) => Math.max(0, n - 1))}>
                            <Ionicons name="remove-circle-outline" size={28} color="#10b981" />
                          </Pressable>
                          <ThemedText style={{ fontSize: 16, fontWeight: '900', color: '#0f172a' }}>{promptExtra}</ThemedText>
                          <Pressable onPress={() => setPromptExtra((n) => Math.min(extraMax, n + 1))}>
                            <Ionicons name="add-circle-outline" size={28} color="#10b981" />
                          </Pressable>
                        </View>
                      </View>
                    )}
                    <Pressable
                      onPress={() => {
                        setPromptSelected(outside.map((p) => p.key));
                        setPromptExtra(extraMax);
                      }}>
                      <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#059669', textAlign: 'center' }}>
                        Marcar a todos ({peoplePrompt.remaining})
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      disabled={total === 0}
                      onPress={() => {
                        const prompt = peoplePrompt;
                        const keys = promptSelected;
                        setPeoplePrompt(null);
                        handleScanQR(prompt.token, total, keys);
                      }}
                      style={{ marginTop: 4, paddingVertical: 14, borderRadius: 14, alignItems: 'center', backgroundColor: total === 0 ? '#a7f3d0' : '#10b981' }}>
                      <ThemedText style={{ fontSize: 15, fontWeight: '900', color: '#ffffff' }}>
                        {total === 0 ? 'Marcá quiénes llegaron' : `Guardar asistencia (${total})`}
                      </ThemedText>
                    </Pressable>
                  </View>
                );
              })()
            ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {Array.from({ length: peoplePrompt?.remaining || 0 }, (_, i) => i + 1).map((n) => (
                <Pressable
                  key={n}
                  onPress={() => {
                    const prompt = peoplePrompt;
                    setPeoplePrompt(null);
                    if (prompt) handleScanQR(prompt.token, n);
                  }}
                  style={{
                    minWidth: 52,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    alignItems: 'center',
                    backgroundColor: n === peoplePrompt?.remaining ? '#10b981' : '#ecfdf5',
                    borderWidth: 1,
                    borderColor: '#10b981',
                  }}>
                  <ThemedText style={{ fontSize: 15, fontWeight: '900', color: n === peoplePrompt?.remaining ? '#ffffff' : '#047857' }}>
                    {n === peoplePrompt?.remaining ? `${n} (todos)` : n}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            )}
            <Pressable
              onPress={() => {
                setPeoplePrompt(null);
                setScanned(false);
              }}
              style={{ marginTop: 16, paddingVertical: 10, alignItems: 'center' }}>
              <ThemedText style={{ fontSize: 13, fontWeight: '700', color: '#64748b' }}>Cancelar</ThemedText>
            </Pressable>
          </View>
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
                      {scanResult.group && scanResult.group > 1 && scanResult.inside !== undefined && scanResult.inside < scanResult.group
                        ? `Ingresan ${scanResult.entering} · ${scanResult.inside} de ${scanResult.group}`
                        : `${scanResult.group || scanResult.guest.confirmed_passes || scanResult.guest.passes || 1} Persona(s)`}
                    </ThemedText>
                    {scanResult.names && scanResult.names.length > 0 && scanResult.group && scanResult.group > 1 ? (
                      <ThemedText style={{ fontSize: 11, color: '#475569', marginTop: 2 }} numberOfLines={3}>
                        {scanResult.names.join(', ')}
                      </ThemedText>
                    ) : null}
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

            {ticketModalGuest && (
              <Pressable
                onPress={() => {
                  const target = ticketModalGuest;
                  setTicketModalGuest(null);
                  // iOS can't present a modal while another one is still closing
                  setTimeout(() => setHistoryGuest(target), 350);
                }}
                style={styles.historyLinkBtn}>
                <Ionicons name="time-outline" size={17} color="#475569" />
                <ThemedText style={styles.historyLinkText}>Ver historial de movimientos</ThemedText>
              </Pressable>
            )}

            <Button
              title="Cerrar Pase"
              onPress={() => setTicketModalGuest(null)}
              style={styles.ticketCloseBtn}
            />
          </View>
        </View>
      </Modal>

      <GuestHistoryModal guest={historyGuest} onClose={() => setHistoryGuest(null)} />

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
