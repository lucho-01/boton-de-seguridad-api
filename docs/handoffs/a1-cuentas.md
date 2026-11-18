# Nota de entrega — A1 · Registro y login con Firebase Auth

## Entrega: orquestador · A1

**Hecho**
- Cuatro rutas: `POST /api/auth/registro` (201), `POST /api/auth/login`, `POST /api/auth/refresh` y `GET /api/auth/yo`.
- Cliente REST de Firebase Auth (signUp, signInWithPassword, securetoken) + claims y borrado con Admin SDK; puerto `ClienteAuth` con doble en pruebas (cero red).
- Registro en tres pasos con rollback (cuenta → claim `rol` → perfil) y perfil mínimo en `usuarios/{uid}`.
- 78 pruebas nuevas (207 en total), todas desde la spec aprobada.

**Archivos**
- Docs: `docs/specs/a1-cuentas.md`, `docs/adr/0007-registro-login-api.md`.
- Contrato: `app/shared/schema.ts` (`RegistroSchema`, `LoginSchema`, `RefreshSchema`, `TokensSesionSchema`, `UsuarioSchema`, `RespuestaCuentaSchema`, `RespuestaYoSchema`).
- Backend: `app/shared/server/{auth-client,auth-rest,index}.ts`, `app/features/accounts/server/{repository,repository.memory,repository.firestore,cuentas-service}.ts`, `app/features/container.ts`, `app/api/auth/{registro,login,refresh,yo}/route.ts`.
- Pruebas: `app/features/accounts/tests/cuentas-service.test.ts`, `app/api/tests/auth.test.ts`.

**Cómo verificar**
- `npm run check` → formato, lint, tipos y 207 pruebas en verde.
- `npm run build` → compila; `/api/auth/registro`, `/api/auth/login`, `/api/auth/refresh`, `/api/auth/yo` como rutas dinámicas.
- En local, con `.env` completo: `POST /api/auth/registro` con `{ "email", "password", "perfil": "persona" }` → 201 con tokens.

**Decisiones**
- El puerto `ClienteAuth` vive en `app/shared/server/auth-client.ts`: `app/shared` no puede importar features (lint) y la implementación real también es compartida.
- `perfil` obligatorio en el registro, sin cambio en A1; no se expone en `usuario` (`{ id, email, rol }`).
- `refresh` rota ambos tokens; login solo con correo y contraseña; sin verificación de correo.
- Si Firestore o los claims fallan tras crear la cuenta, se elimina y se responde 500 opaco.
- `WEAK_PASSWORD` → 400 con mensaje literal y sin `detalles`.

**Pendiente / bloqueos**
- Persona: `.env` y variables en Vercel; rotar la clave privada de servicio y tratar como expuesta la `apiKey` compartida en el chat.
- En Firebase: habilitar correo/contraseña en Authentication y desactivar el registro desde el cliente; pegar `firestore.rules`.
- A6 (límite de intentos) sigue pendiente: hoy el 429 depende del límite de Firebase.
- Riesgo aceptado por contrato: el registro devuelve 409 y revela que un correo existe.

**Revisión de seguridad**
- **Aprobado con observaciones → corregidas.** Informe del agente `security` (solo lectura):
  - **Medio (R4) — corregido**: si fallaba la verificación del ID token *después* de crear cuenta y perfil, no se ejecutaba el rollback y quedaba una cuenta huérfana. Ahora el armado de la respuesta va dentro del mismo `try` que borra la cuenta. Cubierto por 8 pruebas con mutación verificada.
  - **Bajo — corregido**: la clasificación de errores de `firebase-admin` usa `error.code` con tabla y el sufijo del mensaje como respaldo.
  - **Informativo — corregido**: `clienteAuthRest` ya no se reexporta en la fachada; solo el contenedor construye clientes de Firebase.
  - **Aceptado por contrato**: el `409` del registro permite saber si un correo existe; el `429` depende del límite de Firebase hasta A6.
  - **Nota**: un fallo del verificador en login se propaga (401 si es `NoAutenticado`, 500 opaco si es inesperado); no hay rollback en login y no compromete identidad.
  - Tras crear la cuenta, el rollback borra la cuenta de Auth pero **no** el perfil de Firestore (A1 no tiene borrado de perfil); A4 limpia todo.
  - `WEAK_PASSWORD` → 400 sin `detalles` (conforme a `detalles?` opcional).

**Estado final:** `npm run check` → **215 pruebas** en verde; `npm run build` compila las 5 rutas.
