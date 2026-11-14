# Producto — 36 · Botón de seguridad con contactos de confianza

**En una frase:** botón de alerta que, tras una cuenta regresiva cancelable, prepara un SMS con la ubicación de la persona para sus contactos de confianza.

Este documento resume el alcance del proyecto y es la fuente de verdad para las especificaciones. La app móvil (Expo) vive en otro repositorio; **este repo es solo la API**.

## Problema y usuario

Persona que camina sola de noche o viaja y quiere avisar rápido dónde está. Proyecto **atómico**: no se agregan funciones fuera de este documento.

## Reparto entre repositorios

| Repo | Responsabilidad |
| --- | --- |
| `36-boton-de-seguridad-app` | Expo + SQLite, gestos, sensores, redactor de SMS, tokens en `expo-secure-store` |
| `36-boton-de-seguridad-api` (este) | Auth mediada, Firestore con Admin SDK, sincronización, resumen de alertas |

La app **no** contiene `firebaseConfig` ni credenciales. Solo conoce `EXPO_PUBLIC_API_URL` y los tokens del usuario.

## Requisitos funcionales (lado API)

- **RF-01** CRUD y sincronización de contactos de confianza (máximo 5, teléfono de 10 dígitos, sin duplicados).
- **RF-05** Registrar cada alerta (cancelada o con mensaje preparado) y sincronizarla.
- **RF-06** Aviso educativo: no reemplaza la línea de emergencias (Colombia: 123). Lo muestra la app; la API no envía SMS.
- Autenticación con correo y contraseña, con renovación de token.
- Borrado total de la cuenta y sus datos.
- Resumen de alertas por mes.

## Reglas de validación

- Teléfono de exactamente 10 dígitos; máximo 5 contactos; sin duplicados.
- Mensaje de hasta 160 caracteres: se acorta el texto base, nunca el enlace (lo compone la app).
- Si no hay ubicación, el mensaje lo indica; la API acepta `lat`, `lng` y `precision_m` nulos.

## Modelo de datos

SQLite (app):

```sql
CREATE TABLE contacto_confianza (
  id TEXT PRIMARY KEY, nombre TEXT NOT NULL, telefono TEXT NOT NULL, parentesco TEXT
);
CREATE TABLE alerta (
  id TEXT PRIMARY KEY, lat REAL, lng REAL, precision_m REAL, bateria_pct INTEGER,
  estado TEXT NOT NULL CHECK (estado IN ('cancelada','mensaje_preparado')), creada_en TEXT NOT NULL
);
```

Además, cada tabla lleva `remote_id`, `updated_at`, `deleted` y `pending`.

Firestore (API):

```text
usuarios/{uid}/contacto_confianza/{id}
  nombre: string · telefono: string (10 dígitos) · parentesco: string|null
usuarios/{uid}/alerta/{id}
  lat: number|null · lng: number|null · precision_m: number|null · bateria_pct: integer|null
  estado: "cancelada"|"mensaje_preparado" · creada_en: ISO
  created_at, updated_at, deleted_at
```

## Endpoints

### Autenticación (Firebase Auth por REST, mediada por la API)

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `POST /api/auth/registro` | `{ email, password }` (≥ 8) | `201 { token, refreshToken, expiraEnSeg, usuario: { id, email } }` |
| `POST /api/auth/login` | `{ email, password }` | `200` igual |
| `POST /api/auth/refresh` | `{ refreshToken }` | `200 { token, refreshToken, expiraEnSeg }` |
| `GET /api/auth/yo` | Bearer | `200 { usuario }` |

### Sincronización (por recurso privado)

| Método y ruta | Comportamiento |
| --- | --- |
| `GET /api/<recurso>?since=<ISO>` | `200 { items, servidor_ahora }`; máx. 500; incluye borrados lógicos |
| `PUT /api/<recurso>/<id>` | Crea o reemplaza (idempotente); valida con Zod |
| `DELETE /api/<recurso>/<id>` | Borrado lógico; `200 { ok: true }` o `404` |

### Propias

- `GET /api/alertas/resumen` — conteo de alertas por mes.
- `DELETE /api/mi-cuenta` — borra todos los datos de la persona.
- `GET /api/health` — comprobación pública.

## Seguridad

- Todo el acceso a Firestore pasa por la API (Admin SDK); las reglas niegan todo al cliente.
- El `uid` sale del ID token verificado, nunca del cuerpo ni de la URL.
- HTTPS obligatorio; nada de ubicaciones ni teléfonos en logs.
- Errores: `{ "error": "mensaje", "detalles"?: [...] }` con 400/401/403/404/409/413/415/429; los 500 responden `{ "error": "Error interno" }`.
- Rol `admin` como custom claim (`rol = "admin"`); sin él, 403.
- Limitar intentos de login (429) antes de usar datos reales.

## Criterios de aceptación del proyecto

1. Al mantener el botón 3 s empieza la cuenta regresiva y se puede cancelar (app).
2. Si no se cancela, se abre el redactor de SMS con contactos y enlace de ubicación (app).
3. Sin SMS disponible, la app avisa y ofrece copiar el mensaje (app).
4. Si se niega la ubicación, el mensaje se compone sin coordenadas y lo dice (app).
5. La API responde 401 sin token, 400 con datos inválidos y aísla los datos entre usuarios.
