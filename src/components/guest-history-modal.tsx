import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { getAuthHeaders, useAuth } from '@/context/auth-context';
import { fetchWithTimeout } from '@/context/sync-context';
import { APP_URL } from '@/env';

interface Activity {
  id: number;
  action: string;
  description: string | null;
  source: string;
  device: string | null;
  created_at: string;
  user?: { id: number; name: string; role?: string } | null;
}

type IconName = keyof typeof Ionicons.glyphMap;

// Icon and color per movement type
const ACTION_STYLE: Record<string, { icon: IconName; color: string; bg: string }> = {
  created: { icon: 'person-add-outline', color: '#475569', bg: '#f1f5f9' },
  invitation_sent: { icon: 'paper-plane-outline', color: '#2563eb', bg: '#dbeafe' },
  invitation_failed: { icon: 'alert-circle-outline', color: '#dc2626', bg: '#fee2e2' },
  reminder_sent: { icon: 'notifications-outline', color: '#d97706', bg: '#fef3c7' },
  reminder_failed: { icon: 'alert-circle-outline', color: '#dc2626', bg: '#fee2e2' },
  send_uncertain: { icon: 'help-circle-outline', color: '#d97706', bg: '#fef3c7' },
  confirmed: { icon: 'checkmark-circle-outline', color: '#059669', bg: '#d1fae5' },
  declined: { icon: 'close-circle-outline', color: '#e11d48', bg: '#ffe4e6' },
  reset_pending: { icon: 'refresh-outline', color: '#475569', bg: '#f1f5f9' },
  qr_sent: { icon: 'qr-code-outline', color: '#be123c', bg: '#ffe4e6' },
  qr_failed: { icon: 'alert-circle-outline', color: '#dc2626', bg: '#fee2e2' },
  checked_in: { icon: 'enter-outline', color: '#059669', bg: '#d1fae5' },
  check_in_undone: { icon: 'arrow-undo-outline', color: '#d97706', bg: '#fef3c7' },
  scan_repeated: { icon: 'warning-outline', color: '#dc2626', bg: '#fee2e2' },
  table_changed: { icon: 'grid-outline', color: '#7c3aed', bg: '#ede9fe' },
  message_received: { icon: 'chatbubble-ellipses-outline', color: '#0f766e', bg: '#ccfbf1' },
};

const SOURCE_LABEL: Record<string, string> = {
  app: 'App',
  panel: 'Panel web',
  whatsapp: 'WhatsApp',
  invitado: 'Invitado',
  sistema: 'Sistema',
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/** Movement history of one guest: invitation, reminders, answer, QR, check-in, table changes... */
export function GuestHistoryModal({
  guest,
  onClose,
}: {
  guest: { id: number | string; name: string } | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!guest) return;
    let active = true;
    setLoading(true);
    setError(null);
    setActivities([]);
    fetchWithTimeout(`${APP_URL}/guests/${guest.id}/activity`, { headers: getAuthHeaders(user) })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!active) return;
        if (res.ok) setActivities(json?.activities ?? []);
        else setError(json?.message || 'No se pudo cargar el historial.');
      })
      .catch(() => active && setError('Sin conexión: el historial se consulta en el servidor.'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [guest?.id]);

  return (
    <Modal visible={Boolean(guest)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <ThemedText style={styles.eyebrow}>Historial</ThemedText>
              <ThemedText style={styles.title} numberOfLines={1}>{guest?.name}</ThemedText>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#64748b" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color="#e11d48" />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={30} color="#94a3b8" />
              <ThemedText style={styles.emptyText}>{error}</ThemedText>
            </View>
          ) : activities.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="time-outline" size={30} color="#94a3b8" />
              <ThemedText style={styles.emptyText}>Todavía no hay movimientos registrados.</ThemedText>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {activities.map((a, index) => {
                const style = ACTION_STYLE[a.action] ?? { icon: 'ellipse-outline' as IconName, color: '#475569', bg: '#f1f5f9' };
                const userLabel = a.user ? `${a.user.name}${a.user.role === 'hostess' ? ' (anfitriona)' : ''}` : null;
                const who = [SOURCE_LABEL[a.source] ?? a.source, userLabel, a.device].filter(Boolean).join(' · ');
                return (
                  <View key={a.id} style={styles.row}>
                    <View style={styles.iconCol}>
                      <View style={[styles.iconCircle, { backgroundColor: style.bg }]}>
                        <Ionicons name={style.icon} size={16} color={style.color} />
                      </View>
                      {index < activities.length - 1 && <View style={styles.connector} />}
                    </View>
                    <View style={styles.rowContent}>
                      <ThemedText style={styles.rowTitle}>{a.description || a.action}</ThemedText>
                      <ThemedText style={styles.rowMeta}>
                        {formatDateTime(a.created_at)} · {who}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    minHeight: 260,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 12,
    gap: 12,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0f172a',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  iconCol: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    width: 2,
    minHeight: 14,
    backgroundColor: '#eef2f6',
    marginVertical: 2,
  },
  rowContent: {
    flex: 1,
    paddingBottom: 16,
    paddingTop: 5,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  rowMeta: {
    fontSize: 12,
    color: '#64748b',
  },
});
