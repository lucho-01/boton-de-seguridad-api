# ADR-0006 · Base de la API: Next.js App Router, entorno y errores HTTP

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

La feature A0 necesita un framework con el que exponer `GET /api/health` y las rutas privadas, un cliente de Firebase Admin y un único punto donde traducir errores de dominio a respuestas HTTP. Sin eso, cada feature inventaría su propio formato de error y sus propias variables.

## Decisión

- **Next.js (App Router) con Route Handlers** en `app/api/**/route.ts`, `runtime = "nodejs"`. Se añaden `next`, `react` y `react-dom` (Next los exige como dependencias aunque no haya pantallas), más `firebase-admin` para Firestore y la verificación de ID tokens.
- **Errores de dominio** en `app/shared/server/errors.ts` con una clase raíz `ErrorDeDominio` y una subclase por código (tabla de `docs/specs/a0-base.md`). `http.ts` traduce clase → código y cuerpo `{ error, detalles? }`; lo no reconocido es `500 { "error": "Error interno" }`.
- **Entorno:** `app/shared/server/env.ts` es el único lugar que lee `process.env`. Valida con Zod y se memoiza por proceso. `npm run check:env` muestra `presente` / `falta` / `vacía`, nunca valores.
- **Firebase Admin:** inicialización perezosa en `app/shared/server/firebase.ts`; la verificación de token se expone como puerto `VerificadorDeToken` y se conecta en `app/features/container.ts`.
- **Tiempo:** reloj inyectado (`now: () => Date`) desde el contenedor.
- **`GET /api/health`** no verifica token ni toca Firestore; identifica el servicio como `boton-de-seguridad-api` y responde `ok: false` si falta configuración.

## Alternativas consideradas

- **Express/Fastify en funciones serverless:** obliga a otra configuración de despliegue y se separa del App Router del resto del proyecto. Rechazada.
- **Un `try/catch` por ruta con formato propio:** duplica mensajes y códigos. Rechazada.
- **Leer `process.env` en cada servicio:** impide `check:env` coherente y filtra detalles. Rechazada.

## Consecuencias

- `npm run check` sigue siendo formato + lint + tipos + pruebas; `npm run check:full` añade `next build`.
- Las rutas nuevas deben usar los ayudantes de `shared/server/http.ts`; el lint impide importar `server/` de una feature desde una ruta.
- `package.json` gana `dev`, `build`, `start`, `check:full` y `check:env`.
