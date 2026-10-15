import React, { memo } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { getCompanionsLabel, getGuestPasses } from '@/utils/guests';

export interface RSVPGuestItem {
  id: number | string;
  name: string;
  phone: string;
  passes: number;
  confirmed_passes?: number;
  table_number?: string | null;
  rsvp_status: 'confirmed' | 'pending_rsvp' | 'declined';
  dietary_restrictions?: string | null;
  notes?: string | null;
  reminder_sent_at?: string | null;
  reminder_count?: number;
  whatsapp_status?: string | null;
  last_sent_at?: string | null;
}

interface Props {
  guest: RSVPGuestItem;
  isDeadlineExpired: boolean;
  isSendingReminder: boolean;
  isResendingQr: boolean;
  onOpenHistory: (guest: RSVPGuestItem) => void;
  onSendReminder: (guest: RSVPGuestItem) => void;
  onResendQr: (guest: RSVPGuestItem) => void;
  styles: any;
}

const formatDateShort = (isoStr?: string | null): string => {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return '';
  }
};

export const RsvpGuestCard = memo(function RsvpGuestCard({
  guest,
  isDeadlineExpired,
  isSendingReminder,
  isResendingQr,
  onOpenHistory,
  onSendReminder,
  onResendQr,
  styles,
}: Props) {
  const isConfirmed = guest.rsvp_status === 'confirmed';
  const isDeclined = guest.rsvp_status === 'declined';
  const companionsLabel = getCompanionsLabel(guest as any);
  const passes = getGuestPasses(guest as any);

  return (
    <Pressable onPress={() => onOpenHistory(guest)} style={styles.guestCard}>
      <View
        style={[
          styles.guestStatusBar,
          isConfirmed
            ? { backgroundColor: '#10b981' }
            : isDeclined
            ? { backgroundColor: '#fda4af' }
            : { backgroundColor: '#fcd34d' },
        ]}
      />
      <View style={styles.guestInfoCol}>
        <View style={styles.guestNameRow}>
          <ThemedText style={styles.guestName}>{guest.name}</ThemedText>

          {isConfirmed ? (
            <View style={styles.badgeConfirmed}>
              <ThemedText style={styles.badgeConfirmedText}>CONFIRMADO</ThemedText>
            </View>
          ) : isDeclined ? (
            <View style={styles.badgeDeclined}>
              <ThemedText style={styles.badgeDeclinedText}>NO ASISTE</ThemedText>
            </View>
          ) : (
            <View style={styles.badgePending}>
              <ThemedText style={styles.badgePendingText}>PENDIENTE</ThemedText>
            </View>
          )}
        </View>

        {companionsLabel ? (
          <ThemedText style={{ fontSize: 12, color: '#64748b', marginTop: 2 }} numberOfLines={2}>
            👥 con {companionsLabel}
          </ThemedText>
        ) : null}

        <View style={styles.detailsRow}>
          <View style={styles.detailItem}>
            <Ionicons name="people-outline" size={15} color="#64748b" />
            <ThemedText style={styles.detailText}>
              {passes} {passes === 1 ? 'persona' : 'personas'}
            </ThemedText>
          </View>
          <View style={styles.detailItem}>
            <Ionicons
              name={guest.whatsapp_status === 'sent' ? 'paper-plane' : 'paper-plane-outline'}
              size={14}
              color={guest.whatsapp_status === 'sent' ? '#2563eb' : '#94a3b8'}
            />
            <ThemedText style={[styles.detailText, guest.whatsapp_status !== 'sent' && { color: '#94a3b8' }]}>
              {guest.whatsapp_status === 'sent'
                ? `Invitación enviada${guest.last_sent_at ? ` ${formatDateShort(guest.last_sent_at)}` : ''}`
                : 'Invitación sin enviar'}
            </ThemedText>
          </View>
          {guest.table_number ? (
            <View style={styles.tablePill}>
              <ThemedText style={styles.tablePillText}>
                🪑 {guest.table_number.toLowerCase().includes('mesa') ? guest.table_number : `Mesa ${guest.table_number}`}
              </ThemedText>
            </View>
          ) : (
            <ThemedText style={styles.detailSubtle}>Sin mesa</ThemedText>
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

      {!isConfirmed && !isDeclined && !isDeadlineExpired && (
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Pressable
            onPress={() => onSendReminder(guest)}
            disabled={isSendingReminder}
            style={[styles.reminderBtn, isSendingReminder && { opacity: 0.6 }]}>
            {isSendingReminder ? (
              <ActivityIndicator size="small" color="#15803d" />
            ) : (
              <>
                <Ionicons name="logo-whatsapp" size={17} color="#15803d" />
                <ThemedText style={styles.reminderBtnText}>Recordar</ThemedText>
              </>
            )}
          </Pressable>
          {guest.reminder_sent_at ? (
            <ThemedText style={styles.reminderNote} themeColor="textSecondary">
              Recordado el {formatDateShort(guest.reminder_sent_at)}
              {guest.reminder_count ? ` (${guest.reminder_count})` : ''}
            </ThemedText>
          ) : null}
        </View>
      )}

      {isConfirmed && (
        <Pressable
          onPress={() => onResendQr(guest)}
          disabled={isResendingQr}
          style={[styles.qrResendBtn, isResendingQr && { opacity: 0.6 }]}>
          {isResendingQr ? (
            <ActivityIndicator size="small" color="#be123c" />
          ) : (
            <>
              <Ionicons name="qr-code-outline" size={17} color="#be123c" />
              <ThemedText style={styles.qrResendBtnText}>Reenviar QR</ThemedText>
            </>
          )}
        </Pressable>
      )}
    </Pressable>
  );
});
