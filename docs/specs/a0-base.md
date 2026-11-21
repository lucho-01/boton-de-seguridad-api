# Spec A0 · Base: errores y HTTP, entorno validado, Firebase Admin, verificación de token, `health` y `check:env`

- **Estado:** Aprobada
- **Feature:** A0 (ver `docs/features.md`)
- **Fecha:** 2026-11-14
- **Aprobada por:** la persona el 2026-11-14

## 1. Contexto y objetivo

Dejar la base compartida de la API para que A1–A6 solo escriban reglas de negocio: **traducir errores de dominio a respuestas HTTP uniformes, validar el entorno, inicializar Firebase Admin de forma perezosa, verificar el ID token y extraer el `uid`, exponer `GET /api/health` y un `npm run check:env` que muestre estados sin valores.**

## 2. Alcance

- **Incluye:**
  - `app/shared/schema.ts`: contrato común (roles, error HTTP, paginación `since`).
  - `app/shared/server/errors.ts`: clases de error de dominio.
  - `app/shared/server/http.ts`: traducción error → código y cuerpo JSON; lector de Bearer; parseo Zod → 400 con `detalles`.
  - `app/shared/server/env.ts`: único lugar que lee `process.env`; valida con Zod.
  - `app/shared/server/firebase.ts`: inicialización perezosa de Admin SDK y verificación de ID token.
  - `app/shared/server/session.ts`: puerto `VerificadorDeToken` (para probar sin red).
  - `app/shared/server/time.ts`: reloj inyectable (`now: Date`).
  - `app/api/health/route.ts`: `GET /api/health` público.
  - `scripts/check-env.ts` + `npm run check:env`.
  - `app/features/container.ts` vacío (solo el reloj y el verificador).
  - Dependencias: `firebase-admin`, `next`, `react`, `react-dom` (framework y SDK exigidos por el stack).
- **No incluye:** registro/login (A1), contactos (A2), alertas (A3), borrado de cuenta (A4), admin (A5), límite de intentos (A6); middleware de CORS; `firestore.rules` e `firestore.indexes.json` de producción (se agregan con A1/A2 en una spec posterior o en A0 si la persona lo pide).

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `GET /api/health` | ninguna; no requiere token | `200 { "ok": true, "servicio": "boton-de-seguridad-api", "version": "0.1.0" }` | `200 { "ok": false, "servicio": "boton-de-seguridad-api", "version": "0.1.0" }` si falta configuración (no es 500: el proceso está vivo). La ruta es dinámica (`force-dynamic`): nunca se cachea en el build |
| Cualquier ruta privada (base) | `Authorization: Bearer <id token>` | — | `401` sin cabecera, formato inválido, token vencido o inválido |
| Cualquier ruta (base) | — | — | `400` Zod (`detalles: [{ campo, mensaje }]`), `415` si el cuerpo no es JSON, `404` ruta inexistente, `405` método no permitido, `500 { "error": "Error interno" }` |

Campos en `snake_case`. El cuerpo de error es siempre `{ "error": "mensaje", "detalles"?: [{ "campo", "mensaje" }] }`.

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | Todo error de dominio se traduce a un único código HTTP por clase (tabla abajo). Los códigos 400/401/403/404/409/413/415/429 llevan `error` legible; los 500 llevan siempre `{ "error": "Error interno" }` sin `detalles` ni stack. |
| R2 | Un error no reconocido (cualquiera que no sea de dominio) se registra sin datos personales y responde 500 con R1. |
| R3 | La identidad (`uid`) sale **solo** de `verifyIdToken`; la cabecera `Authorization` debe ser exactamente `Bearer <token>` (un espacio, sin comillas). Cualquier otra forma → 401. |
| R4 | Un fallo del verificador (vencido, firma inválida, emisor incorrecto, token revocado) → 401 con el **mismo** mensaje `"Sesión inválida o vencida"`, sin distinguir causas. |
| R5 | El entorno se valida una vez por proceso, de forma perezosa (la primera ruta que lo usa). Faltante o inválido → error de configuración (500 público) y el detalle solo va a logs sin valores. |
| R5b | `validarEntorno` comprueba el formato con Zod además de la presencia: `FIREBASE_PROJECT_ID` (`/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`), `FIREBASE_CLIENT_EMAIL` (`…@….gserviceaccount.com`) y `FIREBASE_PRIVATE_KEY` (contiene `-----BEGIN` y `PRIVATE KEY-----`). `evaluarEntorno` y `check:env` reportan presencia (no validan formato). |
| R6 | `FIREBASE_PRIVATE_KEY` se normaliza (`\\n` → salto de línea). `CORS_ORIGINS` es opcional y se interpreta como lista separada por comas. |
| R7 | `GET /api/health` no verifica token y no toca Firestore: responde en < 500 ms. Es dinámico (`force-dynamic`): refleja el entorno del proceso en ejecución, no el de la compilación. Informa de **presencia** de variables, no de que sean válidas para Firebase. |
| R8 | `npm run check:env` imprime por variable `presente` / `falta` / `vacía` y nunca el valor; código de salida `1` si falta alguna obligatoria. |
| R9 | Los servicios reciben `now: Date`; nadie en `app/features/*/server/` usa `new Date()`. |
| R10 | Los logs nunca contienen contraseñas, tokens, coordenadas ni teléfonos. |

Tabla de traducción (fija el contrato para A1–A6):

| Clase de dominio | HTTP | Uso |
| --- | --- | --- |
| `ErrorDeValidacion` (Zod) | 400 | Cuerpo o query inválidos, con `detalles` |
| `NoAutenticado` | 401 | Sin token o token inválido |
| `NoAutorizado` | 403 | Autenticado sin permiso (p. ej. sin claim `admin`) |
| `NoEncontrado` | 404 | Recurso inexistente o de otro usuario |
| `Conflicto` | 409 | Duplicado (correo, teléfono) |
| `DemasiadoGrande` | 413 | Cuerpo por encima del límite |
| `NoSoportado` | 415 | `Content-Type` no JSON |
| `DemasiadosIntentos` | 429 | Límite de intentos |
| `ErrorInterno` | 500 | Inesperado, sin detalles |

## 5. Autorización

- `GET /api/health`: público (SÍ cualquiera).
- Rutas privadas (base `requiereSesion`): SÍ quien tenga un ID token de Firebase válido del proyecto; NO anónimos ni tokens de otro proyecto.
- El middleware/servicio de sesión no recibe `uid` por parámetro de red: solo lo deriva del token.
- Aislamiento entre usuarios: la base garantiza que el `uid` no puede venir del cuerpo/URL; cada feature lo aplicará en sus rutas Firestore.
- Rol `admin`: el claim `rol` se expone en la sesión (`Session.usuario.rol: "admin" | "usuario"`); su uso real llega en A5.

## 6. Validación y errores

- `EsquemaError` común; `parseoZod` convierte `ZodError` en `400` con `detalles: [{ campo: ruta.join("."), mensaje }]` (máx. 10 detalles, orden estable).
- `ID token`: string no vacío, sin comillas, longitud ≤ 4096. Cabecera ausente → 401 `"Falta la sesión"`.
- `GET /api/health` no valida entrada.
- `check:env`: exit `0` si todas las obligatorias existen; `1` si falta alguna; nunca imprime valores.

## 7. Datos

- No escribe en Firestore. Solo crea el cliente Admin (lazy) para verificar tokens.
- Variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (obligatorias), `FIREBASE_WEB_API_KEY` (obligatoria para A1; A0 la reporta pero no la usa), `CORS_ORIGINS` (opcional).
- `app/features/container.ts` exporta `reloj` y `verificadorDeToken`; sin repositorios hasta A1–A3.

## 8. Criterios de aceptación

1. Dado un error `NoEncontrado("Contacto no existe")` cuando se responde, entonces `404 { "error": "Contacto no existe" }`.
2. Dado un error desconocido cuando se responde, entonces `500 { "error": "Error interno" }` y el log no contiene el mensaje original ni datos personales.
3. Dado un `ZodError` en un campo `telefono`, cuando se valida, entonces `400` con `detalles[0].campo = "telefono"`.
4. Dado `GET /api/health` sin token y con entorno completo, entonces `200 { ok: true, servicio: "boton-de-seguridad-api", version: "0.1.0" }`.
5. Dado `GET /api/health` sin entorno, entonces `200 { ok: false, servicio: "boton-de-seguridad-api", version: "0.1.0" }`.
6. Dado una ruta privada sin `Authorization`, cuando se llama, entonces `401 "Falta la sesión"`.
7. Dado `Authorization: Basic x`, cuando se llama, entonces `401`.
8. Dado un token vencido o inválido, cuando se verifica con un verificador simulado, entonces `401 "Sesión inválida o vencida"`.
9. Dado un token válido con `uid=u1` y `rol=admin`, cuando se abre la sesión, entonces `usuario.id = "u1"`, `rol = "admin"`; sin claim, `rol = "usuario"`.
10. Dado `FIREBASE_PRIVATE_KEY` con `\n` literales, cuando se valida el entorno, entonces la clave contiene saltos reales y no se imprime.
11. Dado `npm run check:env` con variables vacías, entonces imprime `falta` por cada una y sale con código 1.
12. Dado un cuerpo con `Content-Type: text/plain` en una ruta validada, entonces `415`.
13. Todas las pruebas anteriores corren con dobles (sin red y sin Firebase real).
14. Dado un cambio del entorno entre dos llamadas, cuando se pide `GET /api/health`, entonces el `estado` cambia (la ruta no se cachea en el build).
15. Dado `FIREBASE_PROJECT_ID: "x"` y `FIREBASE_CLIENT_EMAIL: "y@x.com"`, cuando se valida el entorno, entonces lanza error de configuración que nombra las variables y no incluye sus valores.

## 9. Pruebas previstas

- Una por criterio (13) en `app/shared/tests/` y `tests/`, con repositorio/verificador en memoria.
- Bordes: token vacío, `Bearer ` sin token, `bearer` en minúsculas, token de 4097 caracteres, `CORS_ORIGINS=" "`.
- Autorización: sin token, token de otro proyecto, claim sin `rol`.
- `check:env` como script probado por función pura (`avaluarEntorno`), no ejecutando el CLI.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿`health` responde 200 con `ok:false` si falta entorno, o 503? | 200 con `ok:false` (la app distingue; no es una caída) | **200 con `ok:false`** |
| 2 | ¿Mensaje 401 exacto? | `"Falta la sesión"` y `"Sesión inválida o vencida"` | Sin respuesta; se mantiene la propuesta (se puede cambiar en la revisión) |
| 3 | ¿Se instala Next.js y `firebase-admin` ahora? | Sí: sin framework no hay rutas que probar | **Sí, instalar** |
| 4 | ¿Tiempo y verificador de token como puertos en el contenedor? | Sí (inyección, pruebas sin red) | **Sí, puertos en el contenedor** |
| 5 | ¿`check:env` falla si falta `FIREBASE_WEB_API_KEY` (solo la usa A1)? | Sí, se trata como obligatoria de despliegue | **Sí, obligatoria** |

## 11. Decisiones y dependencias

- **Dependencias nuevas:** `next`, `react`, `react-dom` (framework), `firebase-admin` (Admin SDK). ADR nuevo: **ADR-0006 · Base de la API: Next.js, entorno y errores HTTP**. **Aprobado por la persona el 2026-11-14.**
- Scripts: `dev`, `build`, `start`, `check:full`, `check:env` (se añaden en A0).
- `firebase-admin` trae `jwks-rsa`/`jose`; mantener el `overrides` de `package.json` si aparece `ERR_REQUIRE_ESM`.
