# Nota de entrega — A3 · Alertas y resumen por mes

## Entrega: orquestador · A3

**Hecho**
- `GET /api/alertas?since`, `PUT /api/alertas/<id>`, `DELETE /api/alertas/<id>` y `GET /api/alertas/resumen` con Bearer.
- Ubicación opcional todo-o-nada con rangos, `bateria_pct` 0–100 o `null`, `estado` `cancelada`/`mensaje_preparado`, `creada_en` no futura (margen 5 min).
- Resumen por mes de `creada_en` en **hora de Colombia (UTC-5)**, ambos estados, sin borrados, solo meses con total > 0 y sin tope.
- 117 pruebas nuevas (402 en total), sin red ni Firebase.

**Archivos**
- Docs: `docs/specs/a3-alertas.md`, `docs/adr/0009-alertas-resumen.md`.
- Contrato: `app/shared/schema.ts` (`AlertaEscrituraSchema`, `AlertaSchema`, `RespuestaAlertasSchema`, `ResumenAlertasSchema`, `MesResumenSchema`).
- Backend: `app/features/alerts/server/{repository,repository.memory,repository.firestore,alertas-service}.ts`, `app/features/container.ts`, `app/api/alertas/{route.ts,[id]/route.ts,resumen/route.ts}`.
- Pruebas: `app/features/alerts/tests/alertas-service.test.ts`, `app/api/tests/alertas.test.ts`.

**Cómo verificar**
- `npm run check` → 402 pruebas, formato, lint y tipos en verde.
- `npm run build` → `/api/alertas`, `/api/alertas/[id]` y `/api/alertas/resumen`.
- `GET /api/alertas/resumen` con Bearer devuelve `{ meses: [{ mes, total }], total }`.

**Decisiones**
- Mes del resumen en UTC-5 (hora de Colombia), calculado por función pura; no se persiste el mes.
- R2 (todo o nada) se valida en el servicio, que conoce la regla completa; los rangos y el enum en la frontera Zod.
- Los literales de validación van en `detalles[].mensaje`, no en `error` (mismo patrón que A1/A2).
- `/api/alertas/resumen` es estática y gana a `[id]` (verificado en el build).

**Pendiente / bloqueos**
- Persona: `.env`, Vercel y rotar la clave de servicio.
- A4 debe borrar las subcolecciones `contacto_confianza` y `alerta`.

**Revisión de seguridad**
- **Aprobado con observaciones → corregidas.** Informe del agente `security` (solo lectura):
  - **Alto — corregido**: `PUT /api/alertas/<id>` aceptaba `creada_en` con año `0000`; `mesEnColombia` generaba `-001-12`, `ResumenAlertasSchema` lanzaba y `GET /api/alertas/resumen` respondía **500 permanente** para toda la cuenta. Corrección en tres capas: cota mínima `2026-01-01` (decidida por la persona, R4), acotado de años < 1900 en `mesEnColombia` y pruebas de regresión (servicio, ruta y función pura).
  - **Medio — cerrado con la misma cota**: fechas de `1900`/`9999` inflaban el resumen sin tope; ya no se aceptan.
  - **Bajo — riesgo aceptado**: el resumen lee todas las alertas no borradas de la cuenta (coste de lectura con decenas de miles); mitigable en A6 o con caché.
  - **Informativo — sin acción**: la ruta estática `/api/alertas/resumen` gana a `[id]` (verificado en los manifiestos del build); logs sin coordenadas ni baterías; transacciones e índices correctos.

**Estado final:** `npm run check` → **412 pruebas** en verde (A0–A3); `npm run build` compila las 9 rutas.
