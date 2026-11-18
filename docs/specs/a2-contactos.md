# Spec A2 · Contactos de confianza: validar, guardar y sincronizar (máx. 5)

- **Estado:** Aprobada
- **Feature:** A2 (ver `docs/features.md`)
- **Fecha:** 2026-11-14
- **Aprobada por:** la persona el 2026-11-14

## 1. Contexto y objetivo

La app guarda los contactos de confianza en SQLite y los sincroniza cuando hay conexión. **La API valida, guarda y devuelve los contactos de cada cuenta sin duplicados, con un máximo de 5, tolerando reintentos y funcionando sin conexión.**

## 2. Alcance

- **Incluye:** `GET /api/contactos?since=<ISO>`, `PUT /api/contactos/<id>`, `DELETE /api/contactos/<id>`; validación de nombre, teléfono y parentesco; límite de 5; duplicados por teléfono; borrado lógico; sincronización por `updated_at`; repositorio en memoria y Firestore.
- **No incluye:** alertas (A3), envío de SMS, invitaciones o confirmación del contacto, lectura pública de contactos, borrado físico (salvo A4).

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `GET /api/contactos?since=<ISO>` | Bearer; `since` opcional ISO 8601 UTC | `200 { items: Contacto[], servidor_ahora }` — máx. 500, incluye borrados (`deleted_at` no nulo) | `400` `since` inválido · `401` sin token |
| `PUT /api/contactos/<id>` | Bearer; `<id>` UUID; `{ nombre, telefono, parentesco? }` | `200` con el documento guardado (`id`, `nombre`, `telefono`, `parentesco`, `created_at`, `updated_at`, `deleted_at: null`) | `400` datos inválidos · `401` · `404` id que no es UUID (ruta inexistente) · `409` límite de 5 o teléfono repetido · `415` no JSON |
| `DELETE /api/contactos/<id>` | Bearer; `<id>` UUID | `200 { ok: true }` | `401` · `404` no existe, es de otro usuario o ya estaba borrado |

`Contacto` en el cable:

```json
{
  "id": "UUID",
  "nombre": "Ana Pérez",
  "telefono": "3001234567",
  "parentesco": "hija",
  "created_at": "2026-11-14T08:00:00.000Z",
  "updated_at": "2026-11-14T08:00:00.000Z",
  "deleted_at": null
}
```

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | `nombre`: recortado, entre 1 y 60 caracteres. |
| R2 | `telefono`: exactamente 10 dígitos (`^[0-9]{10}$`), sin espacios, guiones ni `+`. Se guarda tal cual. |
| R3 | `parentesco`: opcional; si llega, se recorta, 1–40 caracteres; vacío o ausente se guarda como `null`. |
| R4 | Máximo **5 contactos no borrados** por cuenta. Un `PUT` que crearía el 6.º → `409 "Máximo 5 contactos de confianza"`. Un `PUT` sobre uno existente (mismo `id`) no cuenta como nuevo. |
| R5 | **Sin duplicados por teléfono**: dos contactos no borrados del mismo usuario no pueden compartir teléfono → `409 "Ese teléfono ya está en tus contactos"`. Un borrado lógico libera el teléfono. |
| R6 | `PUT` es idempotente: crear o **reemplazar** el documento completo; repetirlo con los mismos datos no duplica ni cambia `created_at`. Reintentar con datos distintos sobre el mismo `id` reemplaza (gana la última escritura). |
| R7 | `PUT` sobre un contacto que estaba borrado lógicamente lo **restaura** (`deleted_at = null`) manteniendo su `created_at`, siempre que respete R4 y R5. |
| R8 | El servidor pone `created_at` (solo la primera vez) y `updated_at` (en cada escritura) con el reloj inyectado; el cliente nunca los envía ni los decide. |
| R9 | `DELETE` es borrado lógico: `deleted_at = updated_at = ahora`. Si el contacto no existe, es de otro usuario **o ya estaba borrado**, → `404 "Contacto no encontrado"`. |
| R10 | `GET ?since` devuelve documentos con `updated_at > since` (o todos si se omite), ordenados por `updated_at` ascendente, máximo 500 por página, **incluidos los borrados**, más `servidor_ahora` (reloj del servidor). La app repite con el último `updated_at` recibido. |
| R11 | `since` inválido o con zona horaria distinta de UTC → `400`. |
| R12 | Todos los datos viven en `usuarios/{uid}/contacto_confianza/{id}` con el `uid` del token; un contacto de otra cuenta es indistinguible de uno inexistente (`404`). |

## 5. Autorización

- Las tres rutas exigen `Authorization: Bearer <ID token>` válido; sin él → `401 "Falta la sesión"`; token inválido → `401 "Sesión inválida o vencida"`.
- El `uid` sale **siempre** del token verificado; nunca de la URL, la query ni el cuerpo. El body con `uid`/`id`/`created_at`/`updated_at`/`deleted_at` se descarta (Zod no los declara).
- Un `<id>` inexistente en la cuenta de otro usuario → `404`, nunca `403`.

## 6. Validación y errores

| Campo | Esquema Zod | Mensaje |
| --- | --- | --- |
| `id` (URL) | `z.uuid()` | ruta inválida → `404` |
| `nombre` | `z.string().trim().min(1).max(60)` | `"El nombre es obligatorio (máx. 60)"` |
| `telefono` | `z.string().regex(/^[0-9]{10}$/)` | `"El teléfono debe tener 10 dígitos"` |
| `parentesco` | `z.string().trim().min(1).max(40).optional().nullable()` | `"El parentesco no debe pasar de 40"` |
| `since` | `FechaIsoSchema` | `"since inválido"` |

Errores de negocio: `409 "Máximo 5 contactos de confianza"`, `409 "Ese teléfono ya está en tus contactos"`, `404 "Contacto no encontrado"`. Los 4xx son literales del dominio y no interponen teléfonos ni ids (regla de `security`).

## 7. Datos

```text
usuarios/{uid}/contacto_confianza/{id}
  nombre: string (1–60)
  telefono: string (10 dígitos)
  parentesco: string | null
  created_at, updated_at: ISO 8601 UTC
  deleted_at: ISO 8601 UTC | null
```

- Índice compuesto necesario para R10: `contacto_confianza` → `updated_at ASC` (se declara en `firestore.indexes.json`).
- El repositorio de Firestore valida cada documento leído con Zod.
- Sin logs de teléfonos ni nombres (datos personales).

## 8. Criterios de aceptación

1. Dado un `PUT` válido nuevo, entonces `200` con `id`, `deleted_at: null` y `created_at === updated_at`.
2. Dado el mismo `PUT` repetido, entonces `200`, un solo documento y el mismo `created_at`.
3. Dado un `PUT` con `telefono: "300 123 4567"` o 9 dígitos, entonces `400` con `detalles[0].campo === "telefono"`.
4. Dado un `nombre` de 61 caracteres o solo espacios, entonces `400`.
5. Dado un usuario con 5 contactos activos, un `PUT` de uno nuevo, entonces `409 "Máximo 5 contactos de confianza"`; actualizar uno existente sigue dando `200`.
6. Dado un teléfono ya usado por un contacto activo, un `PUT` distinto con ese teléfono, entonces `409 "Ese teléfono ya está en tus contactos"`.
7. Dado un contacto borrado con ese teléfono, un `PUT` nuevo con el mismo, entonces `200`.
8. Dado un `DELETE` de un contacto existente, entonces `200 { ok: true }` y `GET ?since` lo devuelve con `deleted_at` no nulo.
9. Dado un segundo `DELETE` del mismo, entonces `404 "Contacto no encontrado"`.
10. Dado el contacto de otro usuario, `PUT`/`DELETE` sobre su `id` → se crea un documento **en la cuenta propia** (PUT, id nuevo para mí) y `DELETE` → `404`.
11. Dado un `GET` sin `since`, entonces todos los contactos (incluidos borrados) y `servidor_ahora` del reloj inyectado.
12. Dado un `GET ?since=<último updated_at>`, entonces solo los modificados después.
13. Dado `GET ?since=2026-11-14T08:00:00`, `/` o con zona `-05:00`, entonces `400`.
14. Dado un `PUT` con `parentesco: ""`, entonces se guarda `null`; con 41 caracteres → `400`.
15. Sin token → `401 "Falta la sesión"` en las tres rutas.
16. Dado un cuerpo con `uid`, `created_at` o `deleted_at`, se ignoran: el documento del token manda y las fechas las pone el servidor.
17. Dado un `PUT` sobre uno borrado con `deleted_at`, entonces lo restaura con `deleted_at: null` y conserva `created_at`.
18. Más de 500 contactos con cambios → `GET` devuelve 500 y la app continúa con el último `updated_at`.

## 9. Pruebas previstas

- Una por criterio (18) con repositorio en memoria, verificador simulado y reloj fijo.
- Bordes: nombre de 1 y 60 (acepta); teléfono `0000000000` y `9999999999` (acepta); `parentesco` de 40 (acepta); 5 contactos (acepta el 5.º, rechaza el 6.º); borrados lógicos no cuentan para el límite.
- Autorización: los tres verbos sin token, con `Basic` y con token vencido.
- Sin red ni Firebase.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿«Sin duplicados» por teléfono o global? | Por teléfono, entre contactos activos de la misma cuenta | **Por teléfono, excluyendo borrados** |
| 2 | ¿Los borrados ocupan cupo de 5? | No | **No cuentan** |
| 3 | ¿`PUT` sobre existente reemplaza siempre? | Sí (última escritura) | **Siempre reemplaza** |
| 4 | ¿Qué devuelve `PUT`? | El documento guardado | **200 con el documento** |
| 5 | ¿`GET` exige Bearer? | Sí | **Sí, exige Bearer** |
| 6 | ¿`parentesco` libre o cerrado? | Texto libre 1–40 | **Texto libre hasta 40** |
| 7 | ¿Longitud del nombre? | 1–60 | **1–60** |
| 8 | ¿`DELETE` repetido? | `404` | **404 si ya estaba borrado** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas. Se reutilizan `requiereSesion`, `manejar`, `exigirJson`, `leerJson`, `respuestaDeError` y `Reloj` de A0.
- ADR nuevo: **ADR-0008 · Contactos: límite, unicidad y sincronización por `updated_at`**.
- El índice de R10 se declara en `firestore.indexes.json` (colección `contacto_confianza`, campo `updated_at`).
