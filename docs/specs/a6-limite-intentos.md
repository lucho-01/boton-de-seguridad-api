# Spec A6 · Límite de intentos de login (429)

- **Estado:** Aprobada
- **Feature:** A6 (ver `docs/features.md`)
- **Fecha:** 2026-11-16
- **Aprobada por:** la persona el 2026-11-16

## 1. Contexto y objetivo

Firebase Auth ya aplica cuotas, pero la API necesita su **propio freno** antes de llamar a Firebase: tras varios fallos de contraseña, el login responde `429` sin consultar credenciales. Así se frena la fuerza bruta, no se gasta cuota y no se revela si el correo existe.

## 2. Alcance

- **Incluye:** contadores de fallos por **correo + IP** y por **IP**; ventana de 15 minutos; bloqueo de 15 minutos; `429 "Demasiados intentos; espera unos minutos"`; almacenamiento en Firestore con TTL; reinicio al iniciar sesión correctamente; pruebas con dobles.
- **No incluye:** límite en registro o refresh, CAPTCHA, bloqueo permanente, listas de IPs reputadas, panel de administración, notificaciones, cambios al contrato de `POST /api/auth/login` (mismo cuerpo y misma respuesta feliz).

## 3. Contrato HTTP

| Método y ruta | Entrada | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `POST /api/auth/login` | `{ email, password }` (sin cambios) | Igual que A1: `200` con tokens y usuario | `400` · `401` credenciales inválidas · `403` cuenta deshabilitada · `429` límite propio · `415` · `500` |

El `429` usa el mismo formato uniforme y el mismo mensaje que A1:

```json
{ "error": "Demasiados intentos; espera unos minutos" }
```

No se añaden campos, cabeceras ni detalles al contrato.

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | Cada intento de login **fallido por credenciales** (`401`) suma un fallo a dos contadores: el **par correo + IP** (`par`) y la **IP** sola. El correo se normaliza como en A1 (recorte y minúsculas). |
| R2 | Ventana de 15 minutos. Si `par` llega a **5 fallos** o la `ip` a **20 fallos**, ese contador queda bloqueado **15 minutos** desde el último fallo. |
| R3 | Antes de llamar a Firebase, si el `par` o la `ip` están bloqueados → `429` inmediato, **sin** validar credenciales y sin revelar si el correo existe. |
| R4 | Solo cuenta como fallo el `401` de credenciales. Un `403` (cuenta deshabilitada), un `429` de Firebase, un `500` o un fallo de red **no** incrementan. Un login correcto **reinicia** ambos contadores (los borra). |
| R5 | El 5.º fallo del par sigue siendo `401` (es un intento real); el **6.º** intento dentro del bloqueo recibe `429`. |
| R6 | Se guarda un **hash SHA-256** del par y de la IP como identificador del documento; nunca el correo, la IP ni la contraseña en claro, ni en Firestore ni en logs. |
| R7 | La IP sale de `x-forwarded-for` (primera dirección, sin puerto) y, si falta, de `x-real-ip`. Sin ninguna → solo se aplica el contador del par con el correo (modo degradado), sin bloquear a todos los clientes. |
| R8 | Aplica **solo al login**. Registro y refresh no consultan ni modifican contadores. |
| R9 | Los contadores viven en Firestore con TTL: `expira_en = ahora + 24 h` (o el fin del bloqueo si es posterior). Si el TTL no está activo en el proyecto, el estado viejo se reinicia igual al leerlo, así que la regla no depende de él. |
| R10 | La API no expone ninguna ruta para consultar o borrar contadores; solo el servicio de login los usa. |
| R11 | **Si el almacén de contadores falla:** `verificar` o `registrarFallo` → `500 "Error interno"` (no se salta el límite por un fallo del almacén); si falla el reinicio tras un login correcto, se registra el fallo y se responde `200` (no se castiga a quien acertó). |

## 5. Autorización

- `POST /api/auth/login` sigue siendo pública (no lleva Bearer).
- El límite identifica al cliente por correo e IP; no hay identidad autenticada todavía.
- Un `429` no permite distinguir correo existente, inexistente, contraseña incorrecta ni cuenta deshabilitada.

## 6. Validación y errores

| Caso | Respuesta |
| --- | --- |
| Cuerpo inválido | `400` de A1, sin tocar contadores |
| Credenciales inválidas dentro del límite | `401 "Correo o contraseña incorrectos"` y suma un fallo |
| Par con ≥ 5 fallos o IP con ≥ 20 en 15 min | `429 "Demasiados intentos; espera unos minutos"` |
| Cuenta deshabilitada | `403` sin sumar fallo |
| Cualquier otro fallo de Firebase | Traducción de A1, sin sumar fallo |

El contador se evalúa **después** de validar el cuerpo con Zod y **antes** de llamar a Firebase.

## 7. Datos

```text
intentos_login/{clave}
  fallos: number (entero >= 1)
  ventana_inicio: ISO 8601 UTC
  bloqueado_hasta: ISO 8601 UTC | null
  expira_en: Timestamp (TTL de Firestore)

clave = "par_" + sha256(correo_normalizado + "|" + ip)   // si hay IP
      = "correo_" + sha256(correo_normalizado)           // modo degradado
      = "ip_" + sha256(ip)
```

- El repositorio solo persiste; la decisión de sumar, bloquear o reiniciar es una función pura del servicio con el reloj inyectado.
- La escritura se hace en una transacción de Firestore (leer → calcular → guardar/borrar) para no perder fallos concurrentes.
- Tarea operativa de la persona: activar la política TTL de Firestore sobre `intentos_login.expira_en` (se documenta en el handoff; no hay archivo de configuración en el repo).

## 8. Criterios de aceptación

1. Dados 5 fallos con el mismo correo e IP, entonces los cinco responden `401` y el sexto `429`.
2. Durante el bloqueo no se llama a Firebase (el doble de Auth registra cero llamadas).
3. Pasados 15 minutos desde el último fallo, el login vuelve a intentarse con normalidad.
4. Un login correcto reinicia los contadores: tras un fallo, un éxito y otro fallo, el contador vuelve a 1.
5. Cinco fallos del mismo correo desde cinco IPs distintas **no** bloquean el par ni el correo para otros clientes.
6. Veinte fallos desde una misma IP con correos variados → `429` para esa IP.
7. Un `403` (cuenta deshabilitada) o un `500` no incrementan el contador.
8. Sin cabeceras de IP, el login sigue funcionando y solo aplica el contador del correo.
9. El `429` no lleva `detalles` y su mensaje es literal; no revela si el correo existe.
10. El contrato de `POST /api/auth/login` no cambia (mismo cuerpo, misma respuesta feliz, mismos 400/401/403/415).
11. Ni Firestore ni los logs contienen correo, IP o contraseña en claro.
12. Si el almacén de contadores falla al verificar o al registrar un fallo, entonces `500` opaco; si falla al reiniciar tras un login correcto, entonces `200` y solo un log sin datos personales.

## 9. Pruebas previstas

- Función pura del contador: ventana, umbral del par (5), umbral de IP (20), bloqueo de 15 min, reinicio por éxito, expiración.
- Servicio con repositorio en memoria, cliente Auth simulado y reloj fijo: criterios 1–8 y 11.
- Ruta real con dobles: `401` ×5 → `429`; el `429` no llama al servicio de Auth; `400`/`415` no tocan contadores; `403` no incrementa.
- Cero red y cero Firebase; sin tocar `.env*`.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿Qué identifica el límite? | Correo + IP (y la IP sola como tope anti-spray) | **Correo + IP** |
| 2 | ¿Umbral y ventana? | 5 fallos / 15 min → bloqueo 15 min | **5 fallos / 15 min** |
| 3 | ¿Se aplica a registro y refresh? | No, solo login | **Solo login** |
| 4 | ¿Dónde se guardan? | Firestore con TTL, hash de correo e IP | **Firestore con TTL** |
| 5 | ¿Tope por IP sola? | 20 fallos / 15 min (decisión de diseño para frenar ataques distribuidos) | **Sí (decisión de diseño)** |
| 6 | ¿El 5.º fallo responde 401 o 429? | `401` y el bloqueo empieza en el 6.º | **401 en el 5.º** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas: `node:crypto` para el hash y la transacción de Firestore que ya usa A2.
- ADR nuevo: **ADR-0012 · Límite de intentos de login: contadores con hash, ventana y TTL**.
- Se reutilizan el reloj inyectado, `DemasiadosIntentos` (429), la traducción de Firebase de A1 y el formato de errores de A0.
- El correo normalizado es el mismo de A1 (`CorreoSchema`).
