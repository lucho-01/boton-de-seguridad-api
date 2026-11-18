# Progreso

Lo mantiene el orquestador: se actualiza al cerrar cada feature (spec aprobada → construida → `npm run check` en verde → `security` → nota en `docs/handoffs/`). Los agentes lo leen al empezar.

## Estado

- **Construido:** configuración de IA (OpenCode, guard, agentes, skills, puertas de calidad).
- **Construido:** A0 (base): errores/HTTP, entorno validado, Firebase Admin perezoso, verificación de token, `health` y `check:env`, con pruebas y `next build` en verde. Revisión de seguridad **Aprobada**.
- **Construido:** A1 (registro/login con Firebase Auth): `/api/auth/{registro,login,refresh,yo}`, cliente REST, rollback de cuenta, perfil mínimo en Firestore. Revisión de seguridad **Aprobada con correcciones aplicadas**. 215 pruebas en verde.
- **Construido:** A2 (contactos): sincronización, límite de 5, unicidad y borrado lógico, con Firestore transaccional. Revisión de seguridad **Aprobada con correcciones aplicadas**.
- **Construido:** A3 (alertas y resumen mensual): sincronización, ubicación opcional, cota de `creada_en` y resumen en hora de Colombia. Revisión de seguridad **Aprobada con correcciones aplicadas** (412 pruebas en verde).
- **Construido:** A4 (borrar mi cuenta): `DELETE /api/mi-cuenta` con confirmación literal, borrado recursivo de Firestore y de la cuenta de Auth, idempotente. Revisión de seguridad **Aprobada con observaciones** (riesgo aceptado en ADR-0010).
- **Construido:** A5 (diagnóstico admin): `GET /api/admin/estado` con claim `admin` verificado y totales agregados; sin datos personales. Revisión de seguridad **Aprobada con observaciones**.
- **Construido:** A6 (límite de intentos de login): contador por correo+IP (5/15 min) y por IP sola (20/15 min), bloqueo de 15 min, TTL en Firestore y fail-closed. 545 pruebas en verde; `npm run build` incluye login y admin.
- **Pendiente de commit:** A0–A6 sin commitear en el worktree; la persona decide cuándo fusionar y hacer push.
- **Specs aprobadas:** A0, A1, A2 y A3 (2026-11-14); A4, A5 y A6 (2026-11-16).

## Decisiones tomadas

- Arquitectura por features con flujo ruta → servicio → repositorio (ADR-0001).
- Firebase Admin para Firestore y Auth REST mediado por la API (ADR-0002).
- Sincronización idempotente con UUID del cliente y borrado lógico (ADR-0003).
- Reglas de código y puertas de calidad automáticas (ADR-0004).
- OpenCode como único harness, con guard y evidencias en `ia/` (ADR-0005).

## Pendientes de la persona

- Crear el proyecto de Firebase y llenar `.env` (los agentes no lo leen).
- Importar el repositorio en Vercel y cargar las variables de producción.
- Rotar la clave de servicio compartida y no volver a compartirla.
- Revisar y firmar la bitácora de IA (`ia/bitacora-ia.md`).
