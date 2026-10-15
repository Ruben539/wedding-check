import React, { memo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Guest } from '@/context/guests-context';
import { getCompanionsLabel, getGuestPasses } from '@/utils/guests';
import { formatDisplayTime, getVipBadgeText, isVipGuest } from './helpers';
import { styles } from './reception.styles';

interface Props {
  guest: Guest;
  isUpdating: boolean;
  isEventToday: boolean;
  onOpen: (guest: Guest) => void;
  onReassignTable: (guest: Guest) => void;
  onCheckInPress: (guest: Guest) => void;
}

/** One guest in the door list: name, status, table, people, diet and the check-in button. */
export const DoorGuestCard = memo(function DoorGuestCard({ guest, isUpdating, isEventToday, onOpen, onReassignTable, onCheckInPress }: Props) {
  const isAttended = guest.status === 'attended';

  return (
    <Pressable
      onPress={() => onOpen(guest)}
      style={[
        styles.guestCard,
        isAttended && styles.guestCardAttended,
      ]}>
      <View style={[styles.guestStatusBar, isAttended && styles.guestStatusBarAttended]} />

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
                INGRESÓ {guest.attended_at ? `· ${formatDisplayTime(guest.attended_at)}` : ''}
              </ThemedText>
            </View>
          ) : (
            <View style={styles.confirmedBadge}>
              <ThemedText style={styles.confirmedBadgeText}>
                POR INGRESAR
              </ThemedText>
            </View>
          )}
        </View>

        {getCompanionsLabel(guest) ? (
          <ThemedText style={{ fontSize: 12, color: '#64748b', marginTop: 2 }} numberOfLines={2}>
            👥 con {getCompanionsLabel(guest)}
          </ThemedText>
        ) : null}

        <View style={styles.detailsRow}>
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onReassignTable(guest);
            }}
            style={styles.tableBadgeProminentClickable}>
            <ThemedText style={styles.tableTextProminent}>
              🪑 {guest.table_number ? (guest.table_number.toLowerCase().includes('mesa') ? guest.table_number : `Mesa ${guest.table_number}`) : 'Sin mesa'}
            </ThemedText>
          </Pressable>

          <View style={styles.passesBadgeSubtle}>
            <ThemedText style={styles.passesTextSubtle}>
              {guest.status === 'attended' && Number(guest.attended_people) > 0 && Number(guest.attended_people) < getGuestPasses(guest)
                ? `${guest.attended_people} de ${getGuestPasses(guest)} ingresaron`
                : `${getGuestPasses(guest)} ${getGuestPasses(guest) === 1 ? 'persona' : 'personas'}`}
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
          onCheckInPress(guest);
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
          <ActivityIndicator color={isAttended ? '#059669' : '#ffffff'} size="small" />
        ) : (
          <>
            <Ionicons
              name={isAttended ? 'checkmark-circle' : isEventToday ? 'enter-outline' : 'time-outline'}
              size={20}
              color={isAttended ? '#059669' : isEventToday ? '#ffffff' : '#94a3b8'}
            />
            <ThemedText
              style={[
                styles.checkInBtnText,
                isAttended && styles.checkInBtnTextActive,
                !isAttended && !isEventToday && styles.checkInBtnTextReadOnly,
              ]}>
              {isAttended ? 'Dentro' : isEventToday ? 'Ingresar' : 'Pendiente'}
            </ThemedText>
          </>
        )}
      </Pressable>

    </Pressable>
  );
});
