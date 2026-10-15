import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { styles } from './reception.styles';

export interface ReceptionStats {
  total: number;
  attended: number;
  pendingEntrance: number;
  totalPasses: number;
  attendedPasses: number;
  pendingEntrancePasses: number;
  progressPercent: number;
  lactoseCount: number;
  celiacCount: number;
  veggieCount: number;
  standardPasses: number;
}

/** Door metrics, check-in progress and catering breakdown. */
export function ReceptionSummary({
  stats,
  onShareKitchenReport,
}: {
  stats: ReceptionStats;
  onShareKitchenReport: () => void;
}) {
  return (
    <>
      {/* Métricas de puerta */}
      <View style={styles.statsRow}>
        <LinearGradient
          colors={['#10b981', '#059669']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statCard}>
          <View style={styles.statIconChipLight}>
            <Ionicons name="checkmark-circle" size={16} color="#ffffff" />
          </View>
          <ThemedText style={styles.statNumber}>{stats.attended}</ThemedText>
          <ThemedText style={styles.statLabel}>Ingresaron</ThemedText>
          <ThemedText style={styles.statSub}>{stats.attendedPasses} personas</ThemedText>
        </LinearGradient>

        <View style={styles.statCardSecondary}>
          <View style={[styles.statIconChip, { backgroundColor: '#fef3c7' }]}>
            <Ionicons name="time-outline" size={16} color="#d97706" />
          </View>
          <ThemedText style={styles.statNumberAmber}>{stats.pendingEntrance}</ThemedText>
          <ThemedText style={styles.statLabelDark}>Por llegar</ThemedText>
          <ThemedText style={styles.statSubDark}>{stats.pendingEntrancePasses} personas</ThemedText>
        </View>

        <View style={styles.statCardSecondary}>
          <View style={[styles.statIconChip, { backgroundColor: '#ffe4e6' }]}>
            <Ionicons name="people-outline" size={16} color="#e11d48" />
          </View>
          <ThemedText style={styles.statNumberDark}>{stats.total}</ThemedText>
          <ThemedText style={styles.statLabelDark}>Confirmados</ThemedText>
          <ThemedText style={styles.statSubDark}>{stats.totalPasses} personas</ThemedText>
        </View>
      </View>

      {/* Progreso de ingreso */}
      <View style={styles.progressCard}>
        <View style={styles.progressHeaderRow}>
          <View>
            <ThemedText style={styles.cardEyebrow}>Progreso de ingreso</ThemedText>
            <ThemedText style={styles.progressTitle}>
              {stats.attended} de {stats.total} invitados
            </ThemedText>
          </View>
          <ThemedText style={styles.progressPercent}>{stats.progressPercent}%</ThemedText>
        </View>
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${stats.progressPercent}%` }]} />
        </View>
        <ThemedText style={styles.progressSubText}>
          {stats.pendingEntrance === 0 && stats.total > 0
            ? '¡Ingresaron todos los confirmados!'
            : `${stats.pendingEntrance} ${stats.pendingEntrance === 1 ? 'invitado por llegar' : 'invitados por llegar'}`}
        </ThemedText>
      </View>

      {/* Catering */}
      <View style={styles.cateringBox}>
        <View style={styles.cateringHeaderRow}>
          <View style={[styles.statIconChip, { backgroundColor: '#dcfce7' }]}>
            <Ionicons name="restaurant-outline" size={16} color="#16a34a" />
          </View>
          <View style={styles.cateringHeaderCol}>
            <ThemedText style={styles.cateringBoxTitle}>Catering y menús</ThemedText>
            <ThemedText style={styles.cateringBoxSub}>
              {stats.totalPasses} platos confirmados · las restricciones aplican solo al invitado indicado
            </ThemedText>
          </View>
        </View>

        <View style={styles.cateringBadgesRow}>
          <View style={styles.cateringBadgeStandard}>
            <ThemedText style={styles.cateringBadgeStandardText}>
              🍽️ {stats.standardPasses} estándar
            </ThemedText>
          </View>

          {stats.lactoseCount > 0 && (
            <View style={styles.cateringBadgeSpecial}>
              <ThemedText style={styles.cateringBadgeSpecialText}>
                🥛 {stats.lactoseCount} sin lactosa
              </ThemedText>
            </View>
          )}

          {stats.celiacCount > 0 && (
            <View style={styles.cateringBadgeSpecial}>
              <ThemedText style={styles.cateringBadgeSpecialText}>
                🌾 {stats.celiacCount} sin TACC
              </ThemedText>
            </View>
          )}

          {stats.veggieCount > 0 && (
            <View style={styles.cateringBadgeSpecial}>
              <ThemedText style={styles.cateringBadgeSpecialText}>
                🌱 {stats.veggieCount} vegetariano
              </ThemedText>
            </View>
          )}
        </View>

        {/* Botón WhatsApp Cocina / Maître */}
        <Pressable onPress={onShareKitchenReport} style={styles.kitchenShareBtn}>
          <Ionicons name="logo-whatsapp" size={18} color="#16a34a" />
          <ThemedText style={styles.kitchenShareTitle}>Enviar reporte a cocina</ThemedText>
        </Pressable>
      </View>
    </>
  );
}
