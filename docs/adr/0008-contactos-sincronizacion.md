# ADR-0008 · Contactos: límite, unicidad y sincronización por `updated_at`

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

A2 aplica por primera vez el patrón de sincronización de ADR-0003 a un recurso privado con reglas de negocio: máximo 5 contactos, sin teléfonos repetidos y reintentos frecuentes desde una app offline.

## Decisión

- **Ruta Firestore:** `usuarios/{uid}/contacto_confianza/{id}`, con el `uid` del token verificado.
- **Límite de 5**: cuentan solo los contactos con `deleted_at = null`. Un `PUT` que crearía el 6.º responde 409; actualizar uno existente no cuenta.
- **Unicidad por teléfono** entre contactos activos de la misma cuenta; un borrado lógico libera el teléfono. No se impone unicidad entre cuentas.
- **`PUT` idempotente**: crear o reemplazar el documento completo; conserva `created_at`, actualiza `updated_at` con el reloj inyectado. Repetir con los mismos datos no duplica ni cambia `created_at`. Un `PUT` sobre un contacto borrado lo restaura.
- **`DELETE` lógico** (`deleted_at = updated_at = ahora`); repetido → 404 (la app lo trata como ya aplicado).
- **`GET ?since`** filtra `updated_at > since`, ordena ascendente, pagina a 500 documentos, incluye borrados y devuelve `servidor_ahora`.
- **Índice:** se declara en `firestore.indexes.json` (`contacto_confianza` → `updated_at ASC`).
- **Concurrencia:** gana la última escritura. El límite y la unicidad se comprueban en una transacción de Firestore (lecturas antes de escrituras, ADR-0003) para que dos `PUT` simultáneos no creen el 6.º ni dupliquen un teléfono.

## Alternativas consideradas

- **Contador del número de contactos en `usuarios/{uid}`:** una lectura menos, pero dos fuentes de verdad que se desincronizan con el borrado lógico. Rechazada.
- **Unicidad global de teléfono entre cuentas:** impide que dos personas de la misma familia guarden el mismo contacto. Rechazada por la persona.
- **`PUT` que rechaza escrituras más viejas:** necesita un reloj del cliente fiable. Rechazada (última escritura del servidor).

## Consecuencias

- Las pruebas usan el repositorio en memoria, que replica las mismas reglas sin Firestore.
- Dos `PUT` simultáneos sobre el 6.º contacto pueden competir; la transacción hace que solo uno gane.
- A4 deberá borrar también la subcolección `contacto_confianza`.
