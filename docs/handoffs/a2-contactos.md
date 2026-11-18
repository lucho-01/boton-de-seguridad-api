# Nota de entrega — A2 · Contactos de confianza

## Entrega: orquestador · A2

**Hecho**
- `GET /api/contactos?since`, `PUT /api/contactos/<id>` y `DELETE /api/contactos/<id>` con Bearer.
- Máximo 5 contactos activos, sin teléfonos repetidos entre activos, `PUT` idempotente que restaura borrados y `DELETE` lógico.
- Repositorios en memoria y Firestore (transacción, Zod por documento), índice `contacto_confianza.updated_at`.
- 75 pruebas de contactos (402 en total con A0–A3).

**Archivos**
- Docs: `docs/specs/a2-contactos.md`, `docs/adr/0008-contactos-sincronizacion.md`, `firestore.indexes.json`.
- Contrato: `app/shared/schema.ts` (`ContactoEscrituraSchema`, `ContactoSchema`, `RespuestaContactosSchema`, `ParentescoSchema`).
- Backend: `app/features/contacts/server/{repository,repository.memory,repository.firestore,contactos-service}.ts`, `app/api/contactos/{route.ts,[id]/route.ts}`, `app/shared/server/http.ts` (`manejarConContexto`).
- Pruebas: `app/features/contacts/tests/contactos-service.test.ts`, `app/api/tests/contactos.test.ts`.

**Cómo verificar**
- `npm run check` → 402 pruebas en verde.
- `npm run build` → `/api/contactos` y `/api/contactos/[id]`.

**Decisiones**
- Límite y unicidad se evalúan en una transacción con lecturas antes de escrituras; el repositorio en memoria replica la misma semántica.
- El cupo cuenta los activos **tras** la escritura; restaurar un borrado no puede añadir el 6.º.
- Reintentos desordenados: gana la última escritura al servidor (sin comparar versiones).

**Pendiente / bloqueos**
- La app debe reintentar pendientes en orden (ADR-0003).
- A4 borrará la subcolección `contacto_confianza`.

**Revisión de seguridad**
- **Aprobado con observaciones → corregidas.**
  - **Medio (R4/R7) — corregido**: restaurar un contacto borrado después de que otro ocupara su hueco permitía llegar a 6 activos con `200`. Ahora el cupo se evalúa sobre los activos que quedan tras la escritura (memoria y Firestore). Cubierto con 5 pruebas de regresión verificadas por mutación.
  - **Bajo — riesgo aceptado**: «gana la última escritura» no compara versiones, así que un reintento viejo de la cola offline puede pisar una edición más nueva. La app debe reintentar en orden.
  - **Informativos**: `DELETE` no revalida cupo (solo `guardar` reactiva un teléfono); `ZodError` en el servicio solo llegaría desde un llamador que ya validó.
  - Limpios: aislamiento entre cuentas, IDOR por `PUT`, logs sin datos personales, transacción y paginación de 500.
