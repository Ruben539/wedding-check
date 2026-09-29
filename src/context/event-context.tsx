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
  timing?: any[];
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

const EVENTS_CACHE_KEY = '@wedding_check_events_cache';

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
          : data.events || data.data || (data.activeEvent ? [data.activeEvent] : []);

        setEvents(evList);
        await storage.setItem(EVENTS_CACHE_KEY, JSON.stringify(evList));

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
        // Fallback a caché offline de eventos reales del servidor
        const cached = await storage.getItem(EVENTS_CACHE_KEY);
        if (cached) {
          const cachedList: EventItem[] = JSON.parse(cached);
          setEvents(cachedList);
          if (cachedList.length > 0) {
            const savedIdStr = await storage.getItem(SELECTED_EVENT_STORAGE_KEY);
            const savedId = savedIdStr ? parseInt(savedIdStr, 10) : null;
            const exists = savedId ? cachedList.some((e) => e.id === savedId) : false;
            setSelectedEventIdState(exists && savedId ? savedId : cachedList[0].id);
          }
        } else {
          setEvents([]);
          setSelectedEventIdState(null);
        }
      }
    } catch {
      // Offline fallback
      try {
        const cached = await storage.getItem(EVENTS_CACHE_KEY);
        if (cached) {
          const cachedList: EventItem[] = JSON.parse(cached);
          setEvents(cachedList);
          if (cachedList.length > 0) {
            const savedIdStr = await storage.getItem(SELECTED_EVENT_STORAGE_KEY);
            const savedId = savedIdStr ? parseInt(savedIdStr, 10) : null;
            const exists = savedId ? cachedList.some((e) => e.id === savedId) : false;
            setSelectedEventIdState(exists && savedId ? savedId : cachedList[0].id);
          }
        } else {
          setEvents([]);
          setSelectedEventIdState(null);
        }
      } catch {
        setEvents([]);
        setSelectedEventIdState(null);
      }
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
