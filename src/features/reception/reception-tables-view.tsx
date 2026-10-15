import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Guest } from '@/context/guests-context';
import { getGuestPasses } from '@/utils/guests';
import { styles } from './reception.styles';

/** Confirmed guests grouped by table, with how many already arrived per table. */
export function ReceptionTablesView({ tableGroups }: { tableGroups: Record<string, Guest[]> }) {
  return (
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
                <ThemedText style={styles.tableCardTitle}>{tableName}</ThemedText>
                <ThemedText style={styles.tableCardSub}>
                  {tableGuests.length} {tableGuests.length === 1 ? 'invitación' : 'invitaciones'} · {totalInTable} personas
                </ThemedText>
              </View>

              <View style={styles.tableCountBadge}>
                <ThemedText style={styles.tableCountText}>
                  {attendedInTable}/{tableGuests.length} llegaron
                </ThemedText>
              </View>
            </View>

            <View style={styles.tableMiniTrack}>
              <View
                style={[
                  styles.tableMiniFill,
                  { width: `${tableGuests.length ? Math.round((attendedInTable / tableGuests.length) * 100) : 0}%` },
                ]}
              />
            </View>

            <View style={styles.tableGuestList}>
              {tableGuests.map((g) => (
                <View key={g.id} style={styles.tableGuestRow}>
                  <View style={styles.tableGuestNameRow}>
                    <View style={[styles.statusDot, g.status === 'attended' && styles.statusDotAttended]} />
                    <ThemedText style={styles.tableGuestName} numberOfLines={1}>{g.name}</ThemedText>
                  </View>

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
  );
}
