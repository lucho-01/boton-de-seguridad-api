# 36 · Botón de seguridad — API

API REST del proyecto **36 · Botón de seguridad con contactos de confianza** (curso de Tendencias). Next.js (App Router) + Firebase Admin + Zod + Vitest, preparada para desplegarse en Vercel. La app móvil (Expo) vive en otro repositorio.

> La API **no envía SMS ni llamadas**: autentica, guarda contactos, registra alertas y sincroniza. El SMS lo abre la app en el teléfono.

## Estado

La API implementa A0–A6: autenticación con Firebase Auth, contactos, alertas, borrado de cuenta, diagnóstico de administración y límite de intentos de login. Incluye Route Handlers, servicios, repositorios Firestore y pruebas. La app móvil vive en otro repositorio.

La integración está configurada en código, pero su conexión con un proyecto Firebase y el despliegue en Vercel deben verificarse con las variables y recursos reales. Consulta `docs/progreso.md` para los pendientes operativos.

## Empezar

Requisitos: Node 24.x, npm y git. Después:

```bash
npm install
npm run check
```

Sigue `docs/empezar.md` para Firebase, el archivo `.env` (lo crea la persona, no la IA), Vercel y el primer mensaje al agente.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run check` | Formato + lint + tipos + pruebas (definición de terminado) |
| `npm test` | Vitest (incluye las pruebas de `ia/`) |
| `npm run lint` | ESLint: reglas, `any`/`unknown`, ternarios y fronteras |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Formato con Biome |
| `npm run dev` | Servidor local de Next.js |
| `npm run build` | Compilación de producción |
| `npm run check:full` | `check` más compilación de producción |
| `npm run check:env` | Comprueba la configuración sin imprimir valores |

## Documentación

- `AGENTS.md` — reglas para los agentes (se lee primero).
- `docs/producto.md` — alcance, requisitos, datos y endpoints.
- `docs/features.md` — lista de features A0–A6 y orden.
- `docs/arquitectura.md` — mapa, flujo, fronteras y sincronización.
- `docs/empezar.md` — puesta en marcha.
- `docs/progreso.md` — qué está hecho y qué sigue.
- `docs/adr/` — decisiones de arquitectura.
- `docs/specs/` — especificaciones (las escribe el orquestador con la persona).
- `docs/handoffs/` — notas de entrega.

## Configuración de IA

Solo **OpenCode**. Está versionada y es parte de la entrega:

```text
AGENTS.md                      reglas del proyecto para la IA
opencode.json                  permisos: secretos, rutas y comandos
.opencode/agents/              lead (orquestador), backend, tests, security
.opencode/skills/              feature-workflow, write-spec, security-review, handoff-note
.opencode/guard/rules.ts       reglas puras del guard
.opencode/plugins/guard.ts     hook que las aplica antes de cada herramienta
ia/bitacora-ia.md              bitácora (propósito, evidencia, validación, decisión)
ia/pruebas/                    pruebas automáticas y guion de demostración en vivo
```

Restricciones demostrables:

1. La IA **no lee** `.env`, claves ni credenciales (solo `.env.example`).
2. La IA **no sale** de la carpeta del repositorio.
3. Las acciones con efecto externo (`git push`, `vercel deploy`, `firebase deploy`, `curl`) **requieren autorización** y el guard las bloquea.
4. La calidad se comprueba automáticamente con `npm run check`, también sobre el código de la IA.

Evidencia rápida:

```bash
npm test          # ejecuta ia/pruebas/guard.test.ts y ia/pruebas/configuracion.test.ts
```

Demostración en vivo: `ia/pruebas/restricciones-en-vivo.md`.

## Estructura

```text
app/api/            Route Handlers HTTP de autenticación, contactos, alertas y cuenta
app/features/       accounts, contacts, alerts (schema, server, tests) + container.ts
app/shared/         contrato común y server (errores, entorno, Firebase)
docs/               producto, features, arquitectura, specs, ADR, handoffs
ia/                 configuración de IA: bitácora y pruebas
scripts/eslint/     reglas locales del lint
tests/              pruebas transversales
```

## Seguridad

- Firestore solo por Admin SDK; `firestore.rules` niega todo al cliente.
- La app móvil no contiene credenciales ni `firebaseConfig`.
- `.env*` en `.gitignore`; los secretos solo en Vercel.
- ID token verificado en cada ruta privada; el `uid` sale del token.
- Errores 500 sin detalles; nada de teléfonos, coordenadas ni tokens en logs.
