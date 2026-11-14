# ADR-0002 · Firebase Admin y Auth REST mediado por la API

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

La app móvil no puede contener credenciales ni `firebaseConfig`: todo lo que empiece por `EXPO_PUBLIC_` queda dentro del APK. Aun así necesita registrar personas, iniciar sesión y renovar la sesión. Firestore debe usarse solo desde el servidor.

## Decisión

- **Firestore:** solo con `firebase-admin` desde la API. `firestore.rules` niega todo al cliente.
- **Authentication:** la API llama a la API REST de Firebase Auth (`accounts:signUp`, `accounts:signInWithPassword` y `securetoken` para renovar) con `FIREBASE_WEB_API_KEY`, que existe solo en Vercel.
- La app recibe `token` (ID token, 1 h), `refreshToken` y `expiraEnSeg`; los guarda en `expo-secure-store`.
- Las rutas privadas verifican el ID token con `getAuth().verifyIdToken()`; el `uid` sale del token verificado.
- Los clientes de Firebase se crean de forma perezosa en `app/shared/server/firebase.ts`; nadie más los construye.
- Variables: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (normalizar `\n`) y `FIREBASE_WEB_API_KEY`.

## Alternativas consideradas

- **SDK web de Firebase en la app:** expone `firebaseConfig` en el APK. Rechazada.
- **Autenticación propia con contraseñas:** la API tendría que guardar hashes y gestionar correos. Rechazada.
- **Firebase Auth con sesiones de cookie:** no encaja con una app móvil que ya usa SQLite offline-first.

## Consecuencias

- La API es la única puerta a los datos y a la sesión.
- Los errores de Firebase se traducen: correo repetido → 409, credenciales inválidas → 401 con el mismo mensaje exista o no el correo, contraseña débil → 400, demasiados intentos → 429.
- `jwks-rsa` necesita `jose` v4: se mantiene el `overrides` de `package.json`.
- La app no ve nunca una clave de Firebase; si se filtra el APK no se filtran credenciales.
