# ADR-0007 · Registro y login mediados por la API

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

ADR-0002 decidió que la app nunca contiene `firebaseConfig`: la API es la única puerta a la sesión. A1 materializa ese contrato con cuatro rutas y necesita fijar cómo habla la API con Firebase Auth, qué guarda en Firestore y qué hace si algo falla a medias.

## Decisión

- **Endpoints de Firebase Auth por REST**, llamados solo desde el servidor con `FIREBASE_WEB_API_KEY` (invisible para la app):
  - `accounts:signUp` → registro;
  - `accounts:signInWithPassword` → login;
  - `securetoken` (`grant_type=refresh_token`) → renovación.
- Las respuestas de Firebase se **validan con Zod** en el mismo punto y se mapean a un `codigoFirebase` tipado; el servicio traduce ese código a la tabla de la spec A1 §6 (mensajes literales, sin interpolar correo ni tokens).
- **Puerto `ClienteAuth`** declarado por la feature `accounts` y implementado en `app/shared/server/auth-rest.ts`; el contenedor lo conecta. Las pruebas usan un doble: cero red.
- **Registro en tres pasos con rollback:** crear cuenta → asignar claim `rol = "usuario"` → crear `usuarios/{uid}` en Firestore. Si un paso posterior a la creación falla, se elimina la cuenta creada y se responde 500. Así no quedan cuentas sin perfil.
- **Perfil mínimo en Firestore:** `usuarios/{uid}` con `email`, `rol`, `perfil` (`persona` | `contacto`), `created_at`, `updated_at`, `deleted_at`. No se guardan contraseñas ni tokens.
- **`perfil` obligatorio en el registro** y sin cambio en A1 (decisión de la persona; se expondrá el cambio cuando exista su spec).
- **Login solo con correo y contraseña**; mismo 401 exista o no el correo.
- **`refresh` rota ambos tokens** (ID y refresh).
- **Timeout de red** de 10 s en cada llamada a Firebase; fallo de red o código desconocido → 500 opaco.

## Alternativas consideradas

- **SDK web de Firebase en la app:** expone `firebaseConfig` en el APK. Rechazada (ADR-0002).
- **Registro desde el cliente con la API key pública:** la app enviaría el `idToken`; permite crear cuentas sin pasar por las reglas de la API. Rechazada.
- **Guardar el perfil antes de crear la cuenta:** Firestore exige un `uid`; obligaría a generar IDs propios y sincronizarlos con Auth. Rechazada.
- **Sin rollback (perfil perezoso):** deja cuentas a medias y obliga a que todas las features toleren perfiles ausentes. Rechazada.

## Consecuencias

- La API es la única que conoce la API key de Auth y las credenciales de servicio.
- Un fallo de Firestore durante el registro devuelve 500 pero no deja cuentas huérfanas.
- El claim `rol` se asigna siempre `"usuario"` en el registro; `admin` se concede fuera de la API (A5).
- Las rutas de A1 dependen de `obtenerEntorno()`, que exige las cuatro `FIREBASE_*`.
