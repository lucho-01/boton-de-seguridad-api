# Progreso

Lo mantiene el orquestador: se actualiza al cerrar cada feature (spec aprobada → construida → `npm run check` en verde → `security` → nota en `docs/handoffs/`). Los agentes lo leen al empezar.

## Estado

- **Construido:** configuración de IA (OpenCode, guard, agentes, skills, puertas de calidad).
- **Spec en curso:** ninguna.
- **Siguiente:** A0 (base: errores/HTTP, entorno, Firebase Admin, verificación de token, `health` y `check:env`), ver `docs/features.md`. El código de la API se agrega en ese momento; todavía no existe.

## Decisiones tomadas

- Arquitectura por features con flujo ruta → servicio → repositorio (ADR-0001).
- Firebase Admin para Firestore y Auth REST mediado por la API (ADR-0002).
- Sincronización idempotente con UUID del cliente y borrado lógico (ADR-0003).
- Reglas de código y puertas de calidad automáticas (ADR-0004).
- OpenCode como único harness, con guard y evidencias en `ia/` (ADR-0005).

## Pendientes de la persona

- Crear el proyecto de Firebase y llenar `.env` (los agentes no lo leen).
- Importar el repositorio en Vercel y cargar las variables de producción.
- Aprobar la especificación de A0 antes de implementar.
- Revisar y firmar la bitácora de IA (`ia/bitacora-ia.md`).
