import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

import { APP_URL } from '@/env';
import { getAuthHeaders, useAuth } from './auth-context';

// Cambio realizado en la app que todavía no llegó al servidor
export interface PendingOp {
  id: string;
  eventId: number;
  method: 'POST' | 'PUT';
  path: string;
  body: Record<string, unknown>;
  // Invitado afectado y cambios a mostrar localmente mientras no se sincronice
  guestId?: number | string;
  patch?: Record<string, unknown>;
  // Invitado creado sin conexión (alta express)
  localGuest?: Record<string, unknown> & { id: number | string };
  createdAt: number;
}

export type NewPendingOp = Omit<PendingOp, 'id' | 'createdAt'>;

export type SendResult =
  | { status: 'sent'; res: Response }
  | { status: 'queued' }
  | { status: 'rejected'; res: Response };

interface SyncContextType {
  pendingOps: PendingOp[];
  isSyncing: boolean;
  // Se incrementa cada vez que se sincronizan cambios, para que las pantallas recarguen datos
  syncVersion: number;
  sendOrQueue: (op: NewPendingOp) => Promise<SendResult>;
  flush: () => Promise<void>;
  applyPendingOps: <T extends { id: number | string }>(list: T[], eventId: number) => T[];
}

const QUEUE_KEY = '@wedding_check_pending_ops';
const REQUEST_TIMEOUT_MS = 10000;

export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Errores temporales: el cambio se conserva para reintentar más tarde
const shouldRetry = (status: number) => status >= 500 || status === 401 || status === 408 || status === 429;

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [pendingOps, setPendingOps] = useState<PendingOp[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncVersion, setSyncVersion] = useState<number>(0);

  const queueRef = useRef<PendingOp[]>([]);
  const userRef = useRef(user);
  const flushingRef = useRef<boolean>(false);
  const inFlightIdRef = useRef<string | null>(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const saveQueue = useCallback(async (next: PendingOp[]) => {
    queueRef.current = next;
    setPendingOps(next);
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const enqueue = useCallback(
    async (input: NewPendingOp) => {
      const queue = queueRef.current;

      // Si el invitado fue creado sin conexión y aún no se envió, se integra el cambio en su alta
      if (input.guestId !== undefined && !input.localGuest) {
        const createOp = queue.find(
          (q) => q.localGuest && String(q.localGuest.id) === String(input.guestId) && q.id !== inFlightIdRef.current
        );
        if (createOp && createOp.localGuest) {
          const merged: PendingOp = {
            ...createOp,
            body: { ...createOp.body, ...input.body },
            localGuest: { ...createOp.localGuest, ...(input.patch || {}) },
          };
          await saveQueue(queue.map((q) => (q.id === createOp.id ? merged : q)));
          return;
        }
      }

      const op: PendingOp = {
        ...input,
        id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      };
      await saveQueue([...queue, op]);
    },
    [saveQueue]
  );

  // Enviar al servidor los cambios pendientes, en el orden en que se hicieron
  const flush = useCallback(async () => {
    if (flushingRef.current || !userRef.current || queueRef.current.length === 0) return;
    flushingRef.current = true;
    setIsSyncing(true);
    let processed = 0;
    let rejected = 0;

    try {
      while (queueRef.current.length > 0) {
        const op = queueRef.current[0];
        inFlightIdRef.current = op.id;
        let res: Response;
        try {
          res = await fetchWithTimeout(`${APP_URL}${op.path}`, {
            method: op.method,
            headers: getAuthHeaders(userRef.current, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(op.body),
          });
        } catch {
          break; // Sin conexión: se reintenta más tarde
        }
        if (shouldRetry(res.status)) break;

        if (!res.ok) rejected++;
        processed++;
        await saveQueue(queueRef.current.filter((q) => q.id !== op.id));
      }
    } finally {
      inFlightIdRef.current = null;
      flushingRef.current = false;
      setIsSyncing(false);
      if (processed > 0) setSyncVersion((v) => v + 1);
      if (rejected > 0) {
        Alert.alert(
          'Sincronización',
          `${rejected} cambio(s) realizados sin conexión fueron rechazados por el servidor y no se aplicaron.`
        );
      }
    }
  }, [saveQueue]);

  const sendOrQueue = useCallback(
    async (input: NewPendingOp): Promise<SendResult> => {
      // Si ya hay cambios pendientes, se encola para respetar el orden
      if (queueRef.current.length > 0) {
        await enqueue(input);
        flush();
        return { status: 'queued' };
      }

      try {
        const res = await fetchWithTimeout(`${APP_URL}${input.path}`, {
          method: input.method,
          headers: getAuthHeaders(userRef.current, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(input.body),
        });
        if (res.ok) return { status: 'sent', res };
        if (shouldRetry(res.status)) {
          await enqueue(input);
          return { status: 'queued' };
        }
        return { status: 'rejected', res };
      } catch {
        await enqueue(input);
        return { status: 'queued' };
      }
    },
    [enqueue, flush]
  );

  // Aplicar sobre una lista de invitados los cambios que todavía no llegaron al servidor
  const applyPendingOps = useCallback(<T extends { id: number | string }>(list: T[], eventId: number): T[] => {
    let result = [...list];
    for (const op of queueRef.current) {
      if (op.eventId !== eventId) continue;
      if (op.localGuest) {
        const localGuest = op.localGuest;
        if (!result.some((g) => String(g.id) === String(localGuest.id))) {
          result = [localGuest as unknown as T, ...result];
        }
      } else if (op.guestId !== undefined && op.patch) {
        const patch = op.patch;
        result = result.map((g) => (String(g.id) === String(op.guestId) ? { ...g, ...patch } : g));
      }
    }
    return result;
  }, []);

  // Cargar la cola guardada al iniciar sesión y sincronizar
  useEffect(() => {
    if (!user) {
      queueRef.current = [];
      setPendingOps([]);
      return;
    }
    let active = true;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(QUEUE_KEY);
        if (!active) return;
        const stored: PendingOp[] = saved ? JSON.parse(saved) : [];
        const extra = queueRef.current.filter((q) => !stored.some((s) => s.id === q.id));
        await saveQueue([...stored, ...extra]);
        flush();
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id, saveQueue, flush]);

  // Sincronizar automáticamente al recuperar la conexión
  useEffect(() => {
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        flush();
      }
    });
    return () => subscription.remove();
  }, [flush]);

  return (
    <SyncContext.Provider value={{ pendingOps, isSyncing, syncVersion, sendOrQueue, flush, applyPendingOps }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync debe ser usado dentro de un SyncProvider');
  }
  return context;
}
