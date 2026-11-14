# ADR-0005 · Configuración de agentes de IA (OpenCode + guard)

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

El documento del proyecto exige diseñar la configuración de IA del repositorio, versionarla en el primer commit y demostrar en vivo que sus restricciones funcionan. El equipo eligió **solo OpenCode** como harness.

## Decisión

- **Un único harness:** OpenCode. `.opencode/` contiene:
  - `agents/lead.md` (orquestador, permisos restringidos), `backend.md`, `tests.md`, `security.md`;
  - `skills/feature-workflow`, `write-spec`, `security-review`, `handoff-note`;
  - `guard/rules.ts` (reglas puras y testeables) y `plugins/guard.ts` (hook `execute.before`).
- **Tres capas de restricción:**
  1. `opencode.json`: permisos de lectura/edición de secretos, `bash` con `ask` por defecto y `deny` para efectos externos, `webfetch: ask`.
  2. Guard: bloquea `.env*` (salvo `.env.example`), `secrets/`, `data/`, claves, rutas fuera del repositorio, comandos destructivos o externos y volcados de entorno. Funciona aunque el modelo formule la ruta de otra manera.
  3. `AGENTS.md`: reglas que el agente lee al empezar (stack, zonas, seguridad, método).
- **Calidad:** `npm run check` es la definición de terminado y se aplica también al código escrito por la IA.
- **Evidencia en `ia/`:**
  - `ia/bitacora-ia.md`: bitácora con Fecha | Propósito | Prompt/Acción | Evidencia | Validación | Decisión.
  - `ia/pruebas/guard.test.ts` y `ia/pruebas/configuracion.test.ts`: pruebas automáticas de las restricciones (se ejecutan con `npm test`).
  - `ia/pruebas/restricciones-en-vivo.md`: guion para la demostración en vivo, con capturas.

## Alternativas consideradas

- **Solo `opencode.json`:** los patrones de permisos no cubren todas las formas de una ruta; el guard cierra ese hueco.
- **Solo instrucciones en `AGENTS.md`:** no son una barrera, son una petición.
- **Sandbox del sistema operativo:** fuera del alcance del curso; el guard es defensa en profundidad, no un sandbox.

## Consecuencias

- El guard debe mantenerse cuando cambie el formato de plugins de OpenCode; los tests avisan.
- Las acciones con efecto externo (`git push`, `vercel`, `firebase deploy`) requieren que la persona las ejecute o autorice.
- La evidencia se puede reproducir con `npm test` y demostrar en vivo con las pruebas manuales descritas en `ia/`.
