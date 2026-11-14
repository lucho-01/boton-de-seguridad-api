# ADR-0004 · Convenciones de código y puertas de calidad

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

El código lo escribe en buena parte un agente. Las reglas que solo viven en un documento se incumplen; las que el comando de verificación bloquea, no. Se necesita una definición de «terminado» única y automática.

## Decisión

- `npm run check` = formato (Biome) + lint (ESLint) + tipos (`tsc`) + pruebas (Vitest). `npm run check:full` añade `next build`.
- **ESLint** hace cumplir las reglas que se pueden automatizar:
  - cero `any` y `unknown` (`no-explicit-any` y selectores de `no-restricted-syntax`);
  - prohibido el operador ternario y llaves obligatorias (`curly`);
  - máximo 100 líneas por función y 10 funciones por clase (regla local en `scripts/eslint/`);
  - fronteras de importación entre `shared`, `features`, `server` y `api`;
  - prohibido `new Date()` en `app/features/*/server/` (el tiempo se inyecta).
- **Biome** solo formatea; no hace lint.
- Los contratos HTTP van en `snake_case`; identificadores en inglés.
- Las pruebas se escriben desde la especificación y nunca se cambian para que pasen.

## Alternativas consideradas

- **Solo Biome:** no permite reglas de arquitectura ni de tipos.
- **Solo revisión humana:** no escala con varios agentes.
- **Reglas en `AGENTS.md` sin automatizar:** es lo que se quiere evitar.

## Consecuencias

- Un agente no puede entregar si `npm run check` falla.
- Las reglas nuevas que se puedan automatizar se añaden a `eslint.config.mjs` en el mismo cambio.
- El lint no puede detectar todo (por ejemplo, un `div` con datos, que aquí no aplica): la revisión y `security` cubren el resto.
