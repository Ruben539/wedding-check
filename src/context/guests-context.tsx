import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { APP_URL } from '@/env';
import { getAuthHeaders, useAuth } from './auth-context';
import { useEvent } from './event-context';
import { fetchWithTimeout, useSync } from './sync-context';

// Named companion of an invitation: own table (null = with the holder) and own check-in
export interface GuestMember {
  id: number;
  name: string;
  category: 'adult' | 'youth' | 'child';
  table_number?: string | null;
  attended_at?: string | null;
}

export interface Guest {
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
  // People of the invitation already inside (groups can come in parts)
  attended_people?: number | null;
  companions?: string | null;
  members?: GuestMember[];
  is_vip?: boolean;
  vip_label?: string;
  reminder_sent_at?: string | null;
  reminder_count?: number;
  whatsapp_status?: string | null;
  last_sent_at?: string | null;
}

interface GuestsContextType {
  // Guest list of the selected event, shared by every screen (with offline changes applied)
  guests: Guest[];
  setGuests: React.Dispatch<React.SetStateAction<Guest[]>>;
  isLoading: boolean;
  lastUpdatedAt: number | null;
  refreshGuests: (options?: { silent?: boolean }) => Promise<void>;
  // Screens that need live data (e.g. the door) register while focused; see useLiveGuests
  setLiveSubscribers: React.Dispatch<React.SetStateAction<number>>;
}

const LIVE_REFRESH_MS = 20000;
const cacheKey = (eventId: number) => `@wedding_check_guests_${eventId}`;

const normalize = (raw: any[]): Guest[] =>
  raw.map((g: any) => ({
    ...g,
    qr_code: g.qr_code || `WC-${String(g.id).padStart(4, '0')}`,
  }));

const GuestsContext = createContext<GuestsContextType | undefined>(undefined);

export function GuestsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { selectedEventId } = useEvent();
  const { syncVersion, applyPendingOps } = useSync();

  const [guests, setGuests] = useState<Guest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [liveSubscribers, setLiveSubscribers] = useState(0);
  const requestIdRef = useRef(0);

  const refreshGuests = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!user || !selectedEventId) {
        setGuests([]);
        return;
      }
      const eventId = selectedEventId;
      const requestId = ++requestIdRef.current;
      if (!silent) setIsLoading(true);

      try {
        if (!silent) {
          // Show the cached list right away (also works offline)
          const cached = await AsyncStorage.getItem(cacheKey(eventId));
          if (requestId === requestIdRef.current) {
            setGuests(cached ? applyPendingOps(normalize(JSON.parse(cached)), eventId) : []);
          }
        }

        const res = await fetchWithTimeout(`${APP_URL}/events/${eventId}/guests`, {
          headers: getAuthHeaders(user),
        });
        if (!res.ok) return;
        const data = await res.json();
        const list = normalize(Array.isArray(data) ? data : data.guests || data.data || []);
        // A newer request (or another event) won the race: ignore this answer
        if (requestId !== requestIdRef.current) return;
        setGuests(applyPendingOps(list, eventId));
        setLastUpdatedAt(Date.now());
        await AsyncStorage.setItem(cacheKey(eventId), JSON.stringify(list));
      } catch {
        // Offline: keep what is on screen (cache already loaded)
      } finally {
        if (!silent && requestId === requestIdRef.current) setIsLoading(false);
      }
    },
    [user, selectedEventId, applyPendingOps]
  );

  // Load on login / event change, and after offline changes reach the server
  useEffect(() => {
    refreshGuests();
  }, [refreshGuests, syncVersion]);

  // Live updates while a screen asks for them and the app is in the foreground,
  // so several door devices see each other's check-ins
  useEffect(() => {
    if (liveSubscribers === 0 || !selectedEventId) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => refreshGuests({ silent: true }), LIVE_REFRESH_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshGuests({ silent: true });
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [liveSubscribers, selectedEventId, refreshGuests]);

  const contextValue = useMemo(
    () => ({ guests, setGuests, isLoading, lastUpdatedAt, refreshGuests, setLiveSubscribers }),
    [guests, isLoading, lastUpdatedAt, refreshGuests]
  );

  return (
    <GuestsContext.Provider value={contextValue}>
      {children}
    </GuestsContext.Provider>
  );
}

export function useGuests() {
  const context = useContext(GuestsContext);
  if (!context) {
    throw new Error('useGuests debe ser usado dentro de un GuestsProvider');
  }
  return context;
}

/** Keeps the guest list refreshing every 20s while the calling screen is focused. */
export function useLiveGuests() {
  const context = useGuests();
  const { setLiveSubscribers, refreshGuests } = context;
  useFocusEffect(
    useCallback(() => {
      setLiveSubscribers((n) => n + 1);
      refreshGuests({ silent: true });
      return () => setLiveSubscribers((n) => Math.max(0, n - 1));
    }, [setLiveSubscribers, refreshGuests])
  );
  return context;
}
