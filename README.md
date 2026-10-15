# Wedding Check

App móvil (Expo / React Native) del sistema de confirmaciones: gestión de invitados y RSVP antes del
evento, acreditación en la puerta el día del evento y seguimiento del timeline.

## Pantallas (`src/app/(tabs)`)
- **Recepción** (`index.tsx`): escaneo de QR, ingreso manual, alta express, mesas y reporte de catering.
  Sus piezas viven en `src/features/reception` (tarjeta de invitado, resumen, vista por mesa, estilos).
- **Invitados** (`invitados.tsx`): estado RSVP, recordatorios y reenvío de QR por el WhatsApp del sistema.
- **Timeline** (`cronograma.tsx`): momentos del evento y su avance.
- **Info Boda** (`config.tsx`): selección del evento.

## Datos
- `context/guests-context.tsx`: lista de invitados compartida por todas las pantallas. Se actualiza sola
  cada 20 s mientras Recepción está abierta, para que varias puertas vean los ingresos de las demás.
- `context/sync-context.tsx`: cola de cambios hechos sin conexión, que se envían al volver la señal.
- Cada petición manda `X-Device-Name`: el historial de cada invitado muestra desde qué celular se hizo cada movimiento.

## Configuración por ambiente
Se define con variables `EXPO_PUBLIC_*`, nunca editando `src/env.ts`:
- Local: copiar `.env.example` como `.env`.
- Builds: perfiles `development`, `preview` y `production` de `eas.json`.

## Comandos
```bash
npx expo start      # desarrollo
npx tsc --noEmit    # tipos
npx expo lint       # lint
```
