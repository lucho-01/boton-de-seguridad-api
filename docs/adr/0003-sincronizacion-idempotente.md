# ADR-0003 · Sincronización idempotente y borrado lógico

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

La app funciona sin conexión: escribe en SQLite y sincroniza cuando puede. Las peticiones se pueden reintentar (red inestable, app cerrada) y dos dispositivos podrían editar lo mismo. La API debe tolerar reintentos sin duplicar datos.

## Decisión

- **El `id` lo genera el cliente** (UUID) y es el mismo en SQLite y Firestore.
- `PUT /api/<recurso>/<id>` crea o **reemplaza** el documento completo (idempotente). Valida con Zod y descarta campos no declarados.
- `GET /api/<recurso>?since=<ISO>` devuelve hasta 500 documentos, incluidos los borrados lógicos, más `servidor_ahora`. La app repite con el último `updated_at` hasta recibir menos de 500.
- `DELETE` es **borrado lógico**: `deleted_at` con fecha. No se borra físicamente (salvo `DELETE /api/mi-cuenta`, que borra todo).
- El servidor pone `created_at`, `updated_at` y `deleted_at`; el cliente no los decide.
- Conflictos: **gana la última escritura** según `updated_at` del servidor.
- `snake_case` en Firestore, igual que las columnas de SQLite; fechas ISO 8601 UTC; sin `undefined` (usar `null`).

## Alternativas consideradas

- **IDs generados por Firestore:** obligan a una ida y vuelta antes de guardar en SQLite y rompen el modo offline.
- **Borrado físico:** la app no podría distinguir "nunca existió" de "se borró en otro dispositivo".
- **Resolución de conflictos por campos o vectores:** complejidad que el proyecto no necesita.

## Consecuencias

- Reintentar una escritura nunca duplica.
- Los documentos borrados siguen ocupando espacio hasta una limpieza manual.
- Las consultas con filtro de rango y orden necesitan índices compuestos (`firestore.indexes.json`).
- En transacciones, todas las lecturas van antes de las escrituras.
