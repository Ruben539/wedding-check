// Configuración por ambiente: se define con variables EXPO_PUBLIC_* (archivo .env en local o el
// perfil de eas.json al compilar), nunca editando este archivo. Ver .env.example.

export const ENTORNO: 'DEV' | 'PRD' = process.env.EXPO_PUBLIC_ENV === 'DEV' ? 'DEV' : 'PRD';

export const APP_URL = process.env.EXPO_PUBLIC_API_URL || 'https://confirmaciones.factosystem.com.py/api';

// ⚠️ SOLO PARA PRUEBAS: permite acreditar invitados y marcar el timeline cualquier día, no solo el día
// del evento. Nunca se activa en producción aunque la variable quede puesta.
export const SKIP_EVENT_DATE_CHECK = ENTORNO === 'DEV' && process.env.EXPO_PUBLIC_SKIP_EVENT_DATE_CHECK === 'true';
