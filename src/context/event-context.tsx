import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_URL } from '@/env';
import { useAuth } from './auth-context';

export interface EventItem {
  id: number;
  title: string;
  couple_names?: string;
  event_date?: string;
  location?: string;
  guest_count?: number;
  description?: string;
}

interface EventContextType {
  events: EventItem[];
  selectedEvent: EventItem | null;
  selectedEventId: number | null;
  isLoading: boolean;
  error: string | null;
  setSelectedEventId: (id: number) => Promise<void>;
  refreshEvents: () => Promise<void>;
}

const SELECTED_EVENT_STORAGE_KEY = '@wedding_check_selected_event_id';

const storage = {
  async getItem(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        const webVal = window.localStorage.getItem(key);
        if (webVal) return webVal;
      }
    } catch {
      // ignore
    }
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // ignore
    }
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventIdState] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadFallbackMockEvents = async () => {
    const today = new Date();
    const todayIso = today.toISOString().split('T')[0];
    const mockList: EventItem[] = [
      {
        id: 1,
        title: 'Boda Sofía & Mateo',
        couple_names: 'Sofía & Mateo',
        event_date: todayIso,
        location: 'Quinta Las Rosas - Asunción',
        guest_count: 156,
      },
      {
        id: 2,
        title: 'Boda Valentina & Diego',
        couple_names: 'Valentina & Diego',
        event_date: '2026-11-28',
        location: 'Castillo del Lago - San Bernardino',
        guest_count: 220,
      },
      {
        id: 3,
        title: 'Boda Camila & Lucas',
        couple_names: 'Camila & Lucas',
        event_date: '2026-12-05',
        location: 'Club Náutico San José',
        guest_count: 180,
      },
    ];

    setEvents(mockList);
    const savedIdStr = await storage.getItem(SELECTED_EVENT_STORAGE_KEY);
    const savedId = savedIdStr ? parseInt(savedIdStr, 10) : null;
    const exists = savedId ? mockList.some((e) => e.id === savedId) : false;

    if (exists && savedId) {
      setSelectedEventIdState(savedId);
    } else {
      setSelectedEventIdState(mockList[0].id);
    }
  };

  const fetchEvents = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setSelectedEventIdState(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (user.token) {
      headers['Authorization'] = `Bearer ${user.token}`;
    }

    try {
      const res = await fetch(`${APP_URL}/event`, {
        method: 'GET',
        headers,
      });

      if (res.ok) {
        const data = await res.json();
        const evList: EventItem[] = Array.isArray(data)
          ? data
          : data.events || data.data || [];

        setEvents(evList);

        if (evList.length > 0) {
          const savedIdStr = await storage.getItem(SELECTED_EVENT_STORAGE_KEY);
          const savedId = savedIdStr ? parseInt(savedIdStr, 10) : null;
          const exists = savedId ? evList.some((e) => e.id === savedId) : false;

          if (exists && savedId) {
            setSelectedEventIdState(savedId);
          } else {
            const todayStr = new Date().toISOString().split('T')[0];
            const todayEv = evList.find((e) => e.event_date && e.event_date.startsWith(todayStr)) || evList[0];
            setSelectedEventIdState(todayEv.id);
            await storage.setItem(SELECTED_EVENT_STORAGE_KEY, String(todayEv.id));
          }
        } else {
          setSelectedEventIdState(null);
        }
      } else {
        await loadFallbackMockEvents();
      }
    } catch {
      await loadFallbackMockEvents();
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const setSelectedEventId = async (id: number) => {
    setSelectedEventIdState(id);
    await storage.setItem(SELECTED_EVENT_STORAGE_KEY, String(id));
  };

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return events[0] || null;
    return events.find((e) => e.id === selectedEventId) || events[0] || null;
  }, [events, selectedEventId]);

  return (
    <EventContext.Provider
      value={{
        events,
        selectedEvent,
        selectedEventId,
        isLoading,
        error,
        setSelectedEventId,
        refreshEvents: fetchEvents,
      }}>
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEvent debe ser usado dentro de un EventProvider');
  }
  return context;
}
