# Bitácora de IA

Una fila por intervención relevante. **Propósito** (qué se quería), **Prompt/Acción** (qué se pidió), **Evidencia** (archivo, comando o captura), **Validación** (cómo se comprobó) y **Decisión** (qué se eligió y por qué).

| Fecha | Propósito | Prompt / Acción | Evidencia | Validación | Decisión |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | Definir la configuración de IA del repo API antes de escribir código | «Monta la arquitectura del proyecto con IA y crea lo que falte según el documento 36» | `AGENTS.md`, `opencode.json`, `.opencode/**`, `ia/**` | `npm run check` (formato, lint, tipos y pruebas) | OpenCode como único harness; permisos + guard + reglas documentadas (ADR-0005) |
| 2026-11-14 | Corregir los permisos propuestos para que no bloqueen `.env.example` ni permitan editar todo | Revisión del `opencode.json` aportado | `opencode.json` con `.env.example: allow` y `edit` de secretos en `deny` | `ia/pruebas/configuracion.test.ts` | Mantener `.env.example` legible; los secretos reales siguen bloqueados |
| 2026-11-14 | Cerrar el hueco de rutas fuera del proyecto y comandos no cubiertos por los patrones | Diseño del guard | `.opencode/guard/rules.ts`, `.opencode/plugins/guard.ts` | `ia/pruebas/guard.test.ts` | Guard propio como segunda capa, con reglas puras y testeables |
| 2026-11-14 | Fijar la calidad automática también para el código de la IA | Configuración de ESLint, Biome y Vitest | `eslint.config.mjs`, `biome.json`, `vitest.config.mts`, `package.json` | `npm run check` en verde | Reglas de `AGENTS.md` automatizadas donde es posible (ADR-0004) |
| Pendiente | Demostrar en vivo que la IA no lee `.env` ni sale del proyecto | Ver `ia/pruebas/restricciones-en-vivo.md` | Capturas en `ia/pruebas/capturas/` | Revisión en la sustentación | — |
| Pendiente | Aprobar la especificación de A0 | `write-spec` con la persona | `docs/specs/a0-...md` | Spec en estado Aprobada | — |
