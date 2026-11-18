# Spec A3 · Alertas: registrar y sincronizar + resumen por mes

- **Estado:** Aprobada
- **Feature:** A3 (ver `docs/features.md`)
- **Fecha:** 2026-11-14
- **Aprobada por:** la persona el 2026-11-14

## 1. Contexto y objetivo

Cada vez que el botón completa la cuenta regresiva (o se cancela), la app guarda una alerta en SQLite con estado, ubicación y batería. **La API registra esas alertas, las sincroniza de forma idempotente y dice cuántas hubo en cada mes.**

## 2. Alcance

- **Incluye:** `GET /api/alertas?since=<ISO>`, `PUT /api/alertas/<id>`, `DELETE /api/alertas/<id>` y `GET /api/alertas/resumen` (conteo por mes); estado `cancelada` | `mensaje_preparado`; ubicación opcional; batería opcional.
- **No incluye:** enviar SMS o llamadas (nunca desde la API), notificaciones push, contactos (A2), filtros por fecha distintos del resumen, borrados físicos (A4).

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `GET /api/alertas?since=<ISO>` | Bearer; `since` opcional | `200 { items: Alerta[], servidor_ahora }`; máx. 500, incluye borrados | `400` `since` inválido · `401` |
| `PUT /api/alertas/<id>` | Bearer; `<id>` UUID; `{ lat, lng, precision_m, bateria_pct, estado, creada_en }` | `200` con la alerta guardada | `400` datos inválidos · `401` · `404` id no UUID · `415` |
| `DELETE /api/alertas/<id>` | Bearer; `<id>` UUID | `200 { ok: true }` | `401` · `404` inexistente, ajeno o ya borrado |
| `GET /api/alertas/resumen` | Bearer | `200 { meses: [{ mes: "2026-11", total: 12 }], total: 87 }` | `401` |

`Alerta` en el cable:

```json
{
  "id": "UUID",
  "lat": 4.7110,
  "lng": -74.0721,
  "precision_m": 12.5,
  "bateria_pct": 76,
  "estado": "mensaje_preparado",
  "creada_en": "2026-11-14T03:22:00.000Z",
  "created_at": "2026-11-14T03:22:05.000Z",
  "updated_at": "2026-11-14T03:22:05.000Z",
  "deleted_at": null
}
```

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | `estado` obligatorio: `"cancelada"` o `"mensaje_preparado"`; otro valor → `400`. |
| R2 | Ubicación libre: `lat`, `lng` y `precision_m` pueden ser `null` (sitio sin GPS). Si alguno viene, todos deben ser numéricos: `lat` ∈ [-90, 90], `lng` ∈ [-180, 180], `precision_m` ≥ 0 y ≤ 100 000 m. Valores parciales (solo `lat`) → `400` con `detalle` en el campo que falta. |
| R3 | `bateria_pct` opcional: entero 0–100 o `null`. |
| R4 | `creada_en` obligatorio: instante ISO 8601 UTC registrado por la app. Debe estar entre **2026-01-01T00:00:00.000Z** y `ahora + 5 minutos` (reloj del servidor): anterior → `400 "La hora de la alerta es demasiado antigua"`; posterior al margen → `400 "La hora de la alerta no puede ser futura"`. La cota mínima evita fechas absurdas que inflan o rompen el resumen. |
| R5 | `PUT` idempotente: crea o reemplaza; conserva `created_at`, actualiza `updated_at` con el reloj (ADR-0003). Reintentar no duplica. |
| R6 | No hay límite de alertas; sí borrado lógico (`DELETE`) con 404 si ya estaba borrado. |
| R7 | `GET ?since`: `updated_at > since`, orden ascendente, máx. 500, incluye borrados, `servidor_ahora`; `since` inválido → `400`. |
| R8 | `GET /api/alertas/resumen`: cuenta **alertas no borradas agrupadas por mes de `creada_en` en la zona horaria de Colombia (UTC-5, sin horario de verano)**: una alerta creada a las `2026-11-01T03:30:00.000Z` cuenta en `"2026-10"` (22:30 del 31 de octubre). Devuelve los meses de más reciente a más antiguo, **solo con total > 0**, sin tope de meses; `total` es la suma. |
| R9 | Los datos viven en `usuarios/{uid}/alerta/{id}` con el `uid` del token; una ruta de otro usuario es indistinguible de inexistente. |
| R10 | La API no envía SMS ni llamadas y nunca registra coordenadas en logs. |

## 5. Autorización

- Todas las rutas exigen Bearer válido (`401 "Falta la sesión"` / `"Sesión inválida o vencida"`).
- El `uid` sale solo del token; `id` ajeno → `404`.
- Sin rutas de administración en A3.

## 6. Validación y errores

| Campo | Esquema Zod | Mensaje |
| --- | --- | --- |
| `estado` | `z.enum(["cancelada", "mensaje_preparado"])` | `"Estado de alerta inválido"` |
| `lat` / `lng` / `precision_m` | `z.number().min/max` nullable, grupo coherente | `"Coordenadas incompletas o fuera de rango"` |
| `bateria_pct` | `z.number().int().min(0).max(100).nullable()` | `"La batería va de 0 a 100"` |
| `creada_en` | `FechaIsoSchema` + entre `2026-01-01T00:00:00.000Z` y `ahora + 5 min` | `"La hora de la alerta es demasiado antigua"` / `"La hora de la alerta no puede ser futura"` |
| `since` | `FechaIsoSchema` | `"since inválido"` |

Errores de negocio: `404 "Alerta no encontrada"`. Los 4xx no interponen coordenadas ni ids.

## 7. Datos

```text
usuarios/{uid}/alerta/{id}
  lat, lng, precision_m: number | null
  bateria_pct: integer | null
  estado: "cancelada" | "mensaje_preparado"
  creada_en: ISO 8601 UTC
  created_at, updated_at: ISO 8601 UTC
  deleted_at: ISO 8601 UTC | null
```

- Índices: `alerta` → `updated_at ASC` (sincronización) y `creada_en DESC` (resumen); ya declarados en `firestore.indexes.json`.
- El repositorio valida cada documento leído con Zod; no se loguean coordenadas.

## 8. Criterios de aceptación

1. Dado un `PUT` válido con ubicación, entonces `200`, `created_at === updated_at` y `deleted_at: null`.
2. Dado un `PUT` con ubicación nula, entonces `200` con `lat`, `lng`, `precision_m` en `null`.
2b. Dada una alerta creada a las `2026-11-01T03:30:00.000Z`, entonces el resumen la cuenta en `"2026-10"` (hora de Colombia).
3. Dado `estado: "otro"`, entonces `400` con `campo: "estado"`.
4. Dado solo `lat` (sin `lng`), entonces `400` con `campo` de coordenadas.
5. Dado `lat: 90.1` o `precision_m: -1`, entonces `400`.
6. Dado `bateria_pct: 101` o `12.5`, entonces `400`.
7. Dado `creada_en` 6 minutos en el futuro, entonces `400`; 4 minutos en el futuro → `200`.
7b. Dado `creada_en` `2026-01-01T00:00:00.000Z`, entonces `200` (mínimo aceptado); `2025-12-31T23:59:59.999Z`, `1900-01-01…` o `0000-01-01…` → `400 "La hora de la alerta es demasiado antigua"`, y el resumen sigue respondiendo `200`.
8. Dado el mismo `PUT` dos veces, entonces un solo documento y mismo `created_at`.
9. Dado `DELETE` y segundo `DELETE`, entonces `200` y luego `404 "Alerta no encontrada"`.
10. Dado `GET ?since`, entonces solo los modificados después, incluidos borrados.
11. Dado `GET /resumen` con alertas en noviembre (2), octubre (1) y una borrada en noviembre, entonces `[{ "mes": "2026-11", "total": 2 }, { "mes": "2026-10", "total": 1 }]` y `total: 3`.
12. Dado `GET /resumen` sin alertas, entonces `{ "meses": [], "total": 0 }`.
13. Dado `creada_en` en otro huso (`-05:00`), entonces se rechaza (se exige UTC con `Z`) → `400`.
14. Sin token → `401` en las cuatro rutas.
15. Dado un `id` ajeno, `DELETE` → `404` y `PUT` crea en la cuenta propia.

## 9. Pruebas previstas

- Una por criterio (15) con repositorio en memoria, verificador simulado y reloj fijo.
- Bordes: `lat` = -90 y 90, `lng` = -180 y 180 (aceptan); `bateria_pct` 0 y 100; `precision_m` 0; alerta en el último segundo del mes vs. el primero del siguiente; 500 y 501 en paginación.
- Autorización en las cuatro rutas; cero red.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿El resumen cuenta por mes de `creada_en` (cuándo ocurrió) o de `created_at` (cuándo se sincronizó)? | `creada_en`, que es lo que la persona vivió | **`creada_en`** |
| 2 | ¿Zona horaria del mes? | UTC (coherente con toda la API); Colombia es UTC-5 | **Hora de Colombia (UTC-5)** |
| 3 | ¿Ambos estados cuentan en el resumen, o solo `mensaje_preparado`? | Ambos (el resumen es el historial de pulsaciones) | **Ambos estados** |
| 4 | ¿Máximo de alertas por mes? | Sin límite | **Sin límite** |
| 5 | ¿Formato del resumen? | `{ meses: [{ mes, total }], total }`, solo meses con total > 0 y de reciente a antiguo | **Solo meses con datos** |
| 6 | ¿Se permite `creada_en` futura? | No, más de 5 minutos → `400` | **Rechazar > 5 min** |
| 6b | ¿Cota mínima de `creada_en`? | 2026-01-01T00:00:00.000Z (corrección del hallazgo alto de seguridad) | **2026-01-01** |
| 7 | ¿Qué extensión cubre el resumen? | Todos los meses con datos, sin límite de 12 | **Sin tope de meses** |
| 8 | ¿`DELETE` de alerta permitido, o el historial es inmutable? | Permitido (la app puede borrar una alerta local) | **Permitido con DELETE lógico** |
| 9 | ¿Ubicación parcial? | Todo o nada | **Todo o nada (400)** |
| 10 | ¿Rango de `lat`/`lng`? | Rechazar fuera de rango | **Rechazar 400** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas. Se reutilizan los ayudantes de A0 y el patrón de A2.
- ADR nuevo: **ADR-0009 · Alertas: ubicación opcional, hora de origen y resumen mensual**.
- Índices ya preparados en `firestore.indexes.json` junto con A2.
