# Lista de features de la API (FDD)

Una feature = **acción + resultado + objeto**, pequeña y con valor visible. Se construyen una por una y la persona aprueba la especificación **antes** de delegar. Aquí no hay reglas de negocio: se deciden al escribir cada spec. El alcance completo está en `docs/producto.md`.

| Id | Feature | Quién | Ola |
| --- | --- | --- | --- |
| **Base** | | | |
| A0 | Base: errores y HTTP, entorno validado, Firebase Admin, verificación de token, `health` y `check:env` | Sistema | 1 |
| A1 | Registro y login con Firebase Auth (registro, login, refresh, `yo`) | App | 1 |
| **Datos** | | | |
| A2 | Contactos de confianza: validar, guardar y sincronizar (máx. 5) | App | 2 |
| A3 | Alertas: registrar y sincronizar + resumen por mes | App | 2 |
| A4 | Borrar mi cuenta y todos mis datos | App | 3 |
| **Administración y abuso** | | | |
| A5 | Rol `admin` y rutas de administración (403 sin el claim) | Administrador | 3 |
| A6 | Límite de intentos de login (429) | Sistema | 3 |

## Orden y dependencias

- **A0 primero:** sin errores/HTTP, entorno y verificación de token no se puede probar nada más.
- A1 depende de A0.
- A2 y A3 dependen de A1 y comparten el patrón de sincronización (`GET ?since`, `PUT` idempotente, `DELETE` lógico).
- A4, A5 y A6 dependen de A1.

## Áreas y carpetas

| Área | Carpeta | Features |
| --- | --- | --- |
| Cuentas | `app/features/accounts` | A1, A4, A5, A6 |
| Contactos | `app/features/contacts` | A2 |
| Alertas | `app/features/alerts` | A3 |
| Transversal | `app/shared/` + `app/api/health` | A0 |

## Alcance mínimo de A0

Su especificación debe decidir, con la persona, al menos: clases de error de dominio y su traducción a HTTP; validación y lectura de variables de entorno (y `npm run check:env` que muestra estados, nunca valores); inicialización perezosa de Firebase Admin; verificación de ID token y extracción del `uid`; formato uniforme de errores; y cómo se prueba todo sin tocar la red.
