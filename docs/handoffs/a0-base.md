# Nota de entrega — A0 · Base de la API

## Entrega: orquestador · A0 (base)

**Hecho**
- Spec `docs/specs/a0-base.md` aprobada por la persona el 2026-11-14 y contrato común en `app/shared/schema.ts`.
- Backend: errores de dominio + traducción HTTP uniforme, entorno validado, Firebase Admin perezoso, verificación de token, `GET /api/health`, `npm run check:env`.
- Pruebas: 75 pruebas de A0 (111 en total con las de `ia/`), todas desde la spec, sin red ni Firebase real.
- Configuración: Next.js App Router, `firestore.rules` que niega todo al cliente, ADR-0006.

**Archivos**
- Docs: `docs/specs/a0-base.md`, `docs/adr/0006-base-api-nextjs.md`, `docs/progreso.md`, `docs/arquitectura.md`, `firestore.rules`.
- Contrato: `app/shared/schema.ts`.
- Backend: `app/shared/server/{errors,http,env,firebase,session,time,index}.ts`, `app/features/container.ts`, `app/api/health/route.ts`, `scripts/check-env.ts`.
- Configuración: `package.json` (scripts `dev`, `build`, `start`, `check:full`, `check:env`), `next.config.ts`, `tsconfig.json`, `vitest.config.mts`, `biome.json`, `.gitignore`.
- Pruebas: `app/shared/tests/{errors,http,session,env}.test.ts`, `app/api/tests/health.test.ts`.

**Cómo verificar**
- `npm run check` → formato, lint, tipos y 111 pruebas en verde.
- `npm run build` → compila; `/api/health` queda como ruta dinámica.
- `npm run check:env` → tabla `VARIABLE · estado` sin valores; exit 1 si falta alguna obligatoria.
- `GET /api/health` → `200 { ok: true, servicio: "boton-de-seguridad-api", version: "0.1.0" }` con entorno completo; `ok: false` con el mismo identificador si falta entorno.

**Decisiones**
- `health` responde 200 con `ok:false` cuando falta entorno (decidido por la persona): la app distingue sin tratar el servidor como caído.
- `FIREBASE_WEB_API_KEY` es obligatoria en `check:env` desde A0 aunque solo la use A1.
- `tsconfig.json` usa `jsx: react-jsx` porque Next 16 lo reescribe en cada `next build`; `next-env.d.ts` se ignora en git.
- Un `Authorization` con formato válido pero token inválido da `401 "Sesión inválida o vencida"`; cabecera ausente da `401 "Falta la sesión"`.

**Pendiente / bloqueos**
- Persona: crear el proyecto de Firebase y llenar `.env` (los agentes no lo leen); cargar las variables en Vercel.
- `npm audit` reporta 7 vulnerabilidades moderadas en dependencias transitivas; revisar con la persona antes de tocar versiones.
- A1 (registro/login) requiere spec aprobada.

**Dudas de la especificación**
- Ninguna bloqueante. Queda abierto el mensaje exacto del 401 por formato de cabecera inválido (la persona puede cambiarlo en la revisión).

**Revisión de seguridad**
- Informe completo del agente `security` (solo lectura): **Aprobado** tras una ronda de correcciones.
- Primera ronda: «Aprobado con observaciones» con 3 hallazgos bajos + informativos. Correcciones aplicadas: `force-dynamic` en `GET /api/health` (el estado ya no se hornea en `next build`), nota de `CORS_ORIGINS` derivada de su estado, validación de formato del entorno con Zod (R5b) y cabeceras `X-Content-Type-Options: nosniff` + `Referrer-Policy: no-referrer` en `next.config.ts`.
- Re-verificación: los hallazgos quedan resueltos o cerrados por contrato explícito (R5b/R7); sin ReDoS en los patrones nuevos, sin fuga de valores en errores de configuración y sin superficie nueva.
- Regla vigente para A1–A6: los mensajes 4xx son literales del dominio y **nunca** interpolan entradas ni datos personales.
- `npm audit`: 7 vulnerabilidades moderadas solo en la cadena de `typescript-eslint` (devDependencies); no se empaquetan en el build, no explotables en este contexto.
