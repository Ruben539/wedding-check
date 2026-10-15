import { Platform, Vibration } from 'react-native';

import type { Guest } from '@/context/guests-context';

// Vibración al escanear: se usa el vibrador del teléfono porque el Taptic Engine de iOS
// se desactiva mientras la cámara está activa
export const vibrateScan = (type: 'success' | 'warning' | 'error') => {
  if (type === 'success') {
    Vibration.vibrate(Platform.OS === 'ios' ? undefined : 200);
  } else {
    // Doble vibración para advertencias y errores
    Vibration.vibrate(Platform.OS === 'ios' ? [0, 250] : [0, 150, 120, 150]);
  }
};

// Check-in time as HH:MM from 'HH:MM', 'HH:MM:SS' or an ISO / SQL datetime (now if empty)
export const formatDisplayTime = (rawTime?: string | null): string => {
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

// Protocol / VIP guests (godparents, witnesses, family...) flagged at the door
export const isVipGuest = (guest: Guest): boolean => {
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

export const getVipBadgeText = (guest: Guest): string => {
  if (guest.vip_label) return guest.vip_label;
  const n = (guest.notes || '').toLowerCase();
  if (n.includes('madrina')) return '👑 MADRINA';
  if (n.includes('padrino')) return '👑 PADRINO';
  if (n.includes('testigo')) return '⭐ TESTIGO';
  if (n.includes('novia') || n.includes('novio')) return '💖 FAMILIA NOVIOS';
  if (n.includes('sobre') || n.includes('regalo')) return '🎁 RECIBIR REGALO/SOBRE';
  return '⭐ PROTOCOLO VIP';
};
