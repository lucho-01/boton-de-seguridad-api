# Spec A1 · Registro y login con Firebase Auth (registro, login, refresh, `yo`)

- **Estado:** Aprobada
- **Feature:** A1 (ver `docs/features.md`)
- **Fecha:** 2026-11-14
- **Aprobada por:** la persona el 2026-11-14

## 1. Contexto y objetivo

La app móvil necesita iniciar sesión sin contener credenciales: **la API registra cuentas, valida contraseñas, renueva la sesión y dice quién soy usando Firebase Auth por REST**, y devuelve tokens que la app guarda en `expo-secure-store`.

## 2. Alcance

- **Incluye:** `POST /api/auth/registro`, `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/yo`; clasificación inicial de la cuenta (persona adulta mayor o contacto) y su custom claim; perfil mínimo en Firestore (`usuarios/{uid}`) con correo y rol; traducción de errores de Firebase; pruebas con dobles (sin red).
- **No incluye:** borrar cuenta (A4), roles `admin` y rutas de administración (A5), límite de intentos propio (A6 — Firebase ya limita y se traduce a 429), verificación de correo, recuperación de contraseña, login con Google, pantallas de la app.

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `POST /api/auth/registro` | `{ email: string, password: string, perfil: "persona" \| "contacto" }` | `201 { token, refreshToken, expiraEnSeg, usuario: { id, email, rol } }` | `400` datos inválidos · `409` correo ya registrado · `415` no JSON |
| `POST /api/auth/login` | `{ email: string, password: string }` | `200 { token, refreshToken, expiraEnSeg, usuario: { id, email, rol } }` | `400` · `401` credenciales inválidas · `429` demasiados intentos |
| `POST /api/auth/refresh` | `{ refreshToken: string }` | `200 { token, refreshToken, expiraEnSeg }` | `400` sin token · `401` token inválido/vencido/revocado · `415` |
| `GET /api/auth/yo` | Bearer | `200 { usuario: { id, email, rol } }` | `401` sin sesión o token inválido |

Campos en `snake_case` salvo los que la app ya usa en la respuesta (`expiraEnSeg`, `refreshToken`), que se mantienen tal como los define `docs/producto.md` y ADR-0002.

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | Correo: se recorta, se pasa a minúsculas y debe tener forma `algo@dominio.tld`; máximo 254 caracteres. |
| R2 | Contraseña: mínimo 8 y máximo 128 caracteres; **no** se recorta (los espacios cuentan) y nunca se registra ni se devuelve. |
| R3 | `perfil` es obligatorio en el registro: `"persona"` (adulta mayor) o `"contacto"` (quien recibe el SOS). Se guarda como custom claim `rol = "usuario"` (Firebase exige que `rol` sea el rol de acceso) y como preferencia `perfil` en Firestore. El valor por defecto es **ninguno**: sin `perfil` → 400. |
| R4 | Antes de crear la cuenta, la API crea su perfil en Firestore. Si Firestore falla al crear el perfil, se elimina la cuenta recién creada y se responde 500 (la cuenta no queda a medias). |
| R5 | Correo repetido → `409 "El correo ya está registrado"`. |
| R6 | Credenciales inválidas en login → `401 "Correo o contraseña incorrectos"`, **el mismo** mensaje exista o no el correo (no se revela si una cuenta existe). |
| R7 | Cuenta deshabilitada → `403 "La cuenta está deshabilitada"`. |
| R8 | Respuesta de Firebase 429 (`TOO_MANY_ATTEMPTS_TRY_LATER`) → `429 "Demasiados intentos; espera unos minutos"`. |
| R9 | `refresh` rota el token: devuelve un ID token y un `refreshToken` nuevos. |
| R10 | `GET /api/auth/yo` responde **solo** con datos del token y de su perfil; el `id` es el `uid` verificado. |
| R11 | La app nunca recibe la `FIREBASE_WEB_API_KEY` ni credenciales: la API llama a `accounts:signUp`, `accounts:signInWithPassword` y `securetoken` desde el servidor. |
| R12 | Ningún log contiene contraseñas, tokens, correos completos ni el `refreshToken`. |

Campos que devuelve `usuario`: `{ id, email, rol }`. El `perfil` no se expone todavía (se usará en la app para decidir la pantalla; se puede añadir cuando la persona lo pida).

## 5. Autorización

- `registro`, `login`, `refresh`: **públicas** (no llevan Bearer); solo aceptan `application/json`.
- `yo`: SÍ quien tenga un ID token válido; el `id` sale del token verificado, nunca del cuerpo ni de la URL.
- No hay rutas de administración en A1; el claim `rol` se asigna siempre `"usuario"` en el registro.

## 6. Validación y errores

| Campo | Esquema Zod | Mensaje |
| --- | --- | --- |
| `email` | `z.string().trim().toLowerCase().pipe(z.email().max(254))` | `"Correo inválido"` |
| `password` | `z.string().min(8).max(128)` | `"La contraseña debe tener entre 8 y 128 caracteres"` |
| `perfil` | `z.enum(["persona", "contacto"])` | `"Elige si eres persona (usuario del botón) o contacto de confianza"` |
| `refreshToken` | `z.string().min(1).max(4096)` | `"Falta el refreshToken"` |

Traducción de códigos de Firebase:

| Código de Firebase Auth | HTTP | Mensaje |
| --- | --- | --- |
| `EMAIL_EXISTS` | 409 | `"El correo ya está registrado"` |
| `EMAIL_NOT_FOUND`, `INVALID_PASSWORD`, `INVALID_LOGIN_CREDENTIALS`, `INVALID_EMAIL` | 401 | `"Correo o contraseña incorrectos"` |
| `WEAK_PASSWORD` | 400 | `"La contraseña es demasiado débil"` |
| `USER_DISABLED` | 403 | `"La cuenta está deshabilitada"` |
| `TOO_MANY_ATTEMPTS_TRY_LATER` | 429 | `"Demasiados intentos; espera unos minutos"` |
| `CONFIGURATION_NOT_FOUND` | 500 | `"Error interno"` (log: falta habilitar Authentication) |
| red caída o código desconocido | 500 | `"Error interno"` |

Los 4xx llevan mensajes literales del dominio (nunca interponen el correo ni el token, regla de `security` para A1–A6).

## 7. Datos

```text
usuarios/{uid}
  email: string (minúsculas)
  rol: "usuario"
  perfil: "persona" | "contacto"
  created_at, updated_at, deleted_at: ISO 8601 | null
```

- `uid` lo genera Firebase Auth; `created_at`/`updated_at` los pone el servidor con el reloj inyectado.
- No se guarda la contraseña ni tokens en Firestore.
- No se necesitan índices nuevos.

## 8. Criterios de aceptación

1. Dado un cuerpo válido, cuando se registra, entonces `201` con `token`, `refreshToken`, `expiraEnSeg > 0` y `usuario.rol === "usuario"`.
2. Dado un correo con mayúsculas y espacios, cuando se registra, entonces llega a Firebase ya normalizado (`ana@x.com`).
3. Dado un correo existente, cuando se registra, entonces `409 "El correo ya está registrado"`.
4. Dada una contraseña de 7 caracteres, cuando se registra, entonces `400` con `detalles[0].campo === "password"`.
5. Dado un registro sin `perfil`, entonces `400` con `detalles[0].campo === "perfil"`.
6. Dado un login con contraseña incorrecta y dado un login con correo inexistente, entonces **ambos** `401 "Correo o contraseña incorrectos"`.
7. Dado un login correcto, entonces `200` con tokens nuevos.
8. Dado un login en una cuenta deshabilitada, entonces `403`.
9. Dado que Firebase responde 429, entonces `429` con el mensaje de R8.
10. Dado un `refreshToken` válido, cuando se renueva, entonces `200` con `token` y `refreshToken` nuevos y `expiraEnSeg`.
11. Dado un `refreshToken` inválido, entonces `401`.
12. Dado `GET /api/auth/yo` con un token válido, entonces `200 { usuario: { id: <uid del token>, email, rol } }`.
13. Dado `GET /api/auth/yo` sin token, entonces `401 "Falta la sesión"`.
14. Dado que Firestore falla al crear el perfil en el registro, entonces se borra la cuenta creada y se responde `500 "Error interno"`.
15. En ningún caso la respuesta contiene la contraseña ni la API key.

## 9. Pruebas previstas

- Una por criterio (15) con un doble del cliente de Firebase Auth y del repositorio en memoria.
- Bordes: contraseña de 8 (acepta) y 129 (rechaza); correo de 255 caracteres; `perfil` con otro valor; cuerpo vacío; `refreshToken` vacío.
- Autorización: `yo` con token de otro proyecto, token vencido, cabecera `Basic`.
- No se hace ninguna petición de red.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿`perfil` obligatorio en el registro (`persona` / `contacto`)? | Sí, obligatorio; sin él, 400 | **Sí, obligatorio** |
| 2 | ¿Se puede cambiar el `perfil` después? | No en A1 (llega con A2/A4 si la persona lo pide) | **No en A1** |
| 3 | ¿La respuesta de `registro`/`login` incluye `perfil`? | No; solo `{ id, email, rol }` | **Solo id, email, rol** |
| 4 | ¿El registro exige verificar el correo? | No; sin verificación, como el documento 36 | **No, sin verificación** |
| 5 | ¿`refresh` rota el `refreshToken`? | Sí, rota ambos tokens | **Sí, rota ambos** |
| 6 | ¿Política de contraseña? | 8–128 caracteres, sin reglas extra (Firebase exige 6; la API sube a 8) | **8–128 sin reglas extra** |
| 7 | Si Firestore falla al crear el perfil, ¿qué se hace? | Rollback de la cuenta | **Rollback de la cuenta** |
| 8 | ¿Se puede iniciar sesión con teléfono? | No; solo correo y contraseña | **Solo usuario/contraseña** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas: `fetch` nativo (Node 24) para la API REST de Firebase Auth; `firebase-admin` ya instalado para los claims.
- ADR nuevo: **ADR-0007 · Registro y login mediados por la API** (endpoints REST, normalización, tabla de errores, perfil mínimo en Firestore, rollback de cuenta).
- El puerto `ClienteAuth` (registrar, iniciarSesion, renovar, asignarClaims) lo declara la feature `accounts`; el contenedor lo conecta con `app/shared/server/auth-rest.ts`.
