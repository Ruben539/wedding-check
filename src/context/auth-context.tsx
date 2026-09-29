import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_URL } from '@/env';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role?: string;
  token?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const STORAGE_KEY = '@wedding_check_user_session';

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
  async removeItem(key: string): Promise<void> {
    try {
      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // ignore
    }
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Cargar sesión guardada al iniciar la aplicación
  useEffect(() => {
    async function loadSavedSession() {
      try {
        const savedSession = await storage.getItem(STORAGE_KEY);
        if (savedSession) {
          const parsedUser: User = JSON.parse(savedSession);
          setUser(parsedUser);
        }
      } catch {
        // En caso de error, iniciar limpio
      } finally {
        setIsLoading(false);
      }
    }
    loadSavedSession();
  }, []);

  const saveUserSession = async (userData: User) => {
    setUser(userData);
    await storage.setItem(STORAGE_KEY, JSON.stringify(userData));
  };

  const login = async (emailInput: string, pass: string) => {
    setIsLoading(true);

    if (!emailInput || !pass) {
      setIsLoading(false);
      throw new Error('Por favor completa todos los campos.');
    }

    try {
      const response = await fetch(`${APP_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          username: emailInput,
          email: emailInput,
          password: pass,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorText = data.message || data.errors?.email?.[0] || data.errors?.username?.[0] || 'Credenciales inválidas.';
        throw new Error(errorText);
      }

      const userData = data.user || {};
      const receivedToken = data.token || data.access_token || data.plainTextToken || (data.data && data.data.token) || undefined;
      const newUser: User = {
        id: String(userData.id || Date.now()),
        name: userData.name || emailInput.split('@')[0],
        email: userData.email || emailInput.toLowerCase(),
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name || 'User')}&background=e11d48&color=fff`,
        role: userData.role || 'Usuario',
        token: receivedToken,
      };

      await saveUserSession(newUser);
    } catch (err: any) {
      if (err.message && !err.message.toLowerCase().includes('failed to fetch') && !err.message.toLowerCase().includes('network request failed')) {
        throw err;
      }
      
      // Fallback local en caso de que la API Laravel no esté corriendo localmente
      const displayName = emailInput.split('@')[0];
      const formattedName = displayName.charAt(0).toUpperCase() + displayName.slice(1);
      const mockUser: User = {
        id: 'usr_' + Date.now(),
        name: formattedName,
        email: emailInput.toLowerCase(),
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(formattedName)}&background=e11d48&color=fff`,
        role: 'Organizador',
        token: 'mock_token_' + Date.now(),
      };

      await saveUserSession(mockUser);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (name: string, email: string, pass: string) => {
    setIsLoading(true);
    await new Promise((res) => setTimeout(res, 500));

    if (!name || !email || !pass) {
      setIsLoading(false);
      throw new Error('Todos los campos son obligatorios.');
    }

    if (!email.includes('@')) {
      setIsLoading(false);
      throw new Error('Ingresa un correo electrónico válido.');
    }

    if (pass.length < 6) {
      setIsLoading(false);
      throw new Error('La contraseña debe tener al menos 6 caracteres.');
    }

    const newUser: User = {
      id: 'usr_' + Date.now(),
      name: name.trim(),
      email: email.toLowerCase(),
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=e11d48&color=fff`,
      role: 'Organizador de Eventos',
    };

    await saveUserSession(newUser);
    setIsLoading(false);
  };

  const logout = async () => {
    setIsLoading(true);
    await storage.removeItem(STORAGE_KEY);
    setUser(null);
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser usado dentro de un AuthProvider');
  }
  return context;
}

export function getAuthHeaders(user: User | null, extraHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...extraHeaders,
  };
  if (user?.token) {
    headers['Authorization'] = `Bearer ${user.token}`;
  }
  return headers;
}
