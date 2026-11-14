---
name: feature-workflow
description: Flujo del orquestador para construir una feature de la API con varios agentes (especificar, contrato, dividir por zonas, delegar, integrar, revisar, registrar).
---

# Flujo de una feature de la API

1. **Elegir** la feature en `docs/features.md` (FDD: una acción pequeña con resultado visible).
2. **Especificar** con `write-spec`. Sin especificación aprobada por la persona no se delega.
3. **Contrato:** revisar `app/features/<feature>/schema.ts` y `app/shared/schema.ts`. Solo el orquestador los cambia, antes de delegar.
4. **Dividir por zonas** (nadie edita fuera de su zona):

   | Agente | Zona |
   | --- | --- |
   | backend | `app/features/*/server/**`, `app/shared/server/**`, `app/features/container.ts`, `app/api/**` |
   | tests | `ia/**`, `tests/**`, `app/features/*/tests/**`, `app/shared/tests/**` |
   | security | solo lectura |
   | orquestador | `docs/**`, `AGENTS.md`, `opencode.json`, `app/shared/schema.ts`, `app/features/*/schema.ts` |

5. **Delegar** con: ruta de la especificación, zona, criterio de terminado y comando de verificación. Recuerda las reglas de `AGENTS.md` (cero `any`/`unknown`, sin ternarios, funciones ≤ 100 líneas, `snake_case` en el cable) y las de seguridad (identidad desde el token, Zod en la frontera, errores sin detalles).
6. **Orden recomendado:** backend → tests → integrar → security. Paralelizar solo lo que no comparte archivos.
7. **Integrar:** `npm run check` (y `npm run build` si hay rutas nuevas).
8. **Revisar:** pide el informe a `security`; corrige con el agente dueño de la zona hasta "Aprobado".
9. **Registrar:** nota en `docs/handoffs/<feature>.md`; actualiza `docs/progreso.md`; ADR si hubo decisión de arquitectura.
