# Spec A4 · Borrar mi cuenta y todos mis datos

- **Estado:** Aprobada
- **Feature:** A4 (ver `docs/features.md`)
- **Fecha:** 2026-11-16
- **Aprobada por:** la persona el 2026-11-16

## 1. Contexto y objetivo

La persona debe poder **desaparecer de la API**: borrar su cuenta de Firebase Auth y todos sus datos privados (perfil, contactos de confianza y alertas) con una sola petición, sin llamar a soporte y sin dejar rastros en Firestore. Es la contraparte del derecho al olvido y cierra el ciclo de vida de la cuenta.

## 2. Alcance

- **Incluye:** `DELETE /api/mi-cuenta` con Bearer y confirmación explícita en el cuerpo; borrado físico de `usuarios/{uid}` y de sus subcolecciones `contacto_confianza` y `alerta`; borrado de la cuenta de Firebase Auth; respuesta `{ ok: true }`; pruebas con dobles (sin red y sin Firebase).
- **No incluye:** borrado diferido o periodo de gracia, exportación de datos, baja de la app móvil, notificaciones al usuario, rutas de administración (A5), límite de intentos (A6), recuperación de contraseña.

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `DELETE /api/mi-cuenta` | Bearer; `Content-Type: application/json`; `{ confirmar: "BORRAR" }` | `200 { ok: true }` | `400` confirmación ausente o distinta · `401` sin sesión o token inválido · `413` cuerpo enorme · `415` no JSON · `500` fallo al borrar |

Cuerpo de la petición:

```json
{ "confirmar": "BORRAR" }
```

Respuesta feliz:

```json
{ "ok": true }
```

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | Exige `confirmar` con el literal exacto `"BORRAR"` (sensible a mayúsculas). Ausente, vacío u otro valor → `400` con `detalles[{ campo: "confirmar", mensaje: "Escribe BORRAR para confirmar" }]`. Sin confirmación no se borra nada. |
| R2 | El `uid` sale **solo** del ID token verificado; el cuerpo no puede elegir a quién borrar. No hay parámetros de ruta ni query. |
| R3 | Borra **físicamente** todo dato privado de la cuenta: el documento `usuarios/{uid}`, y sus subcolecciones `contacto_confianza` y `alerta` (incluidos los documentos con borrado lógico). No quedan documentos huérfanos. |
| R4 | Después de borrar los datos, borra la cuenta de Firebase Auth con `deleteUser(uid)`. Así el correo queda libre y la persona no puede volver a iniciar sesión. |
| R5 | **Orden e idempotencia:** primero Firestore (subárbol `usuarios/{uid}`) y luego Auth. Si Firestore falla, la cuenta sigue utilizable y se responde `500`; reintentar completa el borrado. Si Auth falla después de borrar los datos, se responde `500` y reintentar solo necesita la segunda mitad. Si la cuenta de Auth ya no existe (`USER_NOT_FOUND`), se considera **éxito**. |
| R6 | Todo o nada hacia el cliente: solo se responde `200 { ok: true }` cuando los datos y la cuenta de Auth están borrados (o ya no existían). Cualquier otro fallo → `500 { "error": "Error interno" }`, sin detalles ni stack. |
| R7 | La respuesta exitosa es `200 { ok: true }`; nunca devuelve correo, `uid`, tokens ni conteos. |
| R8 | Ni los logs ni las respuestas 4xx/5xx incluyen correo, `uid`, tokens, teléfonos ni coordenadas. Los logs dicen solo tipo de fallo y ubicación. |
| R9 | Tras el borrado, el ID token que trajo la petición puede seguir siendo aceptado por Firebase hasta que expire (máximo ~1 h). La cuenta ya no puede obtener tokens nuevos (refresh revocado) y los datos borrados no se recrean por sí solos; si ese token escribiera de nuevo, crearía datos de una cuenta sin Auth. **Riesgo aceptado y documentado** en ADR-0010; se puede cerrar del todo con `checkRevoked` o un tombstone en A5/A6. |
| R10 | La operación no envía correos ni notificaciones y no requiere confirmar la contraseña en A4. |

## 5. Autorización

- Ruta privada: exige `Authorization: Bearer <ID token>` válido (`401 "Falta la sesión"` / `"Sesión inválida o vencida"`).
- Solo se puede borrar la cuenta del `uid` del token; no existe forma de borrar otra cuenta desde A4.
- Un `admin` (A5) se borra a sí mismo como cualquier usuario; todavía no hay borrado de terceros.

## 6. Validación y errores

| Campo | Esquema Zod | Mensaje |
| --- | --- | --- |
| `confirmar` | `z.literal("BORRAR", { error: "Escribe BORRAR para confirmar" })` | `"Escribe BORRAR para confirmar"` |
| cuerpo | `Content-Type: application/json`; máx. 64 KB | `415` / `413` de A0 |

Errores de negocio:

- `401` sin token o token inválido (formato uniforme de A0).
- `500 "Error interno"` si falla Firestore o Firebase Auth (salvo `USER_NOT_FOUND` en Auth, que es éxito).

## 7. Datos

```text
usuarios/{uid}                          ← se borra el documento
usuarios/{uid}/contacto_confianza/*     ← se borra la subcolección completa
usuarios/{uid}/alerta/*                 ← se borra la subcolección completa
Firebase Auth: cuenta del uid           ← deleteUser(uid)
```

- El repositorio de la cuenta usa el borrado recursivo de Firestore Admin sobre `usuarios/{uid}`, que elimina el documento y todas sus subcolecciones. No conoce las features de contactos ni de alertas: el subárbol entero pertenece a la cuenta.
- El puerto de Auth ya expone `eliminarCuenta(uid)` (usado por el rollback de A1); A4 lo reutiliza.
- No se añaden índices: el borrado no consulta por campo.

## 8. Criterios de aceptación

1. Dado `DELETE /api/mi-cuenta` con `{ "confirmar": "BORRAR" }` y Bearer válido, entonces `200 { ok: true }`, el perfil, las dos subcolecciones y la cuenta de Auth quedan borrados.
2. Dado el cuerpo `{}` o `{ "confirmar": "borrar" }`, entonces `400` con `detalles[0].campo === "confirmar"` y mensaje `"Escribe BORRAR para confirmar"`; no se borra nada.
3. Dado un `DELETE` sin `Content-Type: application/json`, entonces `415`; con un cuerpo mayor de 64 KB, `413`.
4. Sin token o con token inválido → `401` y no se borra nada.
5. Dado un fallo de Firestore, entonces `500 { "error": "Error interno" }` y la cuenta de Auth sigue existiendo; un reintento correcto termina en `200`.
6. Dado un fallo de Auth después de borrar los datos, entonces `500`; un reintento con la cuenta de Auth ya inexistente o con el fallo resuelto termina en `200`.
7. Dado que la cuenta de Auth ya no existe (`USER_NOT_FOUND`) pero el token verifica, entonces `200 { ok: true }` y los datos se borran igualmente.
8. Dado el mismo `DELETE` dos veces con tokens válidos, entonces ambas terminan en `200` (idempotente) y no falla por datos ya borrados.
9. La respuesta y los logs no contienen correo, `uid`, tokens, teléfonos ni coordenadas.
10. El `uid` borrado es el del token: el cuerpo solo aporta la confirmación.

## 9. Pruebas previstas

- Servicio con repositorio en memoria y cliente de Auth simulado: éxito, confirmación inválida, fallo de Firestore (500 sin tocar Auth), fallo de Auth (500), `USER_NOT_FOUND` tratado como éxito, segundo intento idempotente, y que se borre exactamente el `uid` de la sesión.
- Ruta real `DELETE /api/mi-cuenta` con dobles: `200`, `400` con campo `confirmar`, `415`, `401`, `500` opaco.
- Cero red y cero Firebase; las pruebas no tocan `.env` ni credenciales.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿Qué borra `DELETE /api/mi-cuenta`? | Todo, incluida la cuenta de Auth | **Todo, incluida la cuenta de Auth** |
| 2 | ¿Confirmación explícita en el cuerpo? | Exigir `{ confirmar: "BORRAR" }` | **Exigir `{ confirmar: "BORRAR" }`** |
| 3 | ¿Qué responde si algo falla a mitad? | Todo o nada: `500` y reintento | **Todo o nada: 500 y reintento** |
| 4 | ¿Qué devuelve al terminar? | `200 { ok: true }` | **`200 { ok: true }`** |
| 5 | ¿Periodo de gracia o borrado diferido? | No: borrado inmediato | **No (implícito en la respuesta 1)** |
| 6 | ¿Se exige la contraseña además del token? | No en A4; el Bearer es la prueba de identidad | **No (decisión de diseño)** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas. Se reutilizan `manejar`/`leerJson`, `requiereSesion`, el puerto `ClienteAuth` y el patrón de errores de A0/A1.
- ADR nuevo: **ADR-0010 · Borrado de cuenta: orden, idempotencia y tokens vigentes**.
- `app/features/accounts` amplía su puerto de repositorio con el borrado del subárbol de la cuenta; la raíz de composición no cambia de forma.
