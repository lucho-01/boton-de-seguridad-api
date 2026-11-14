# ADR-0001 · Arquitectura por features (FDD) con tres capas

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

Varios agentes de IA trabajan sobre la misma API y deben saber exactamente dónde vive cada cosa y qué pueden tocar. El documento del proyecto habla de MVC (`controllers`, `models`, `services`); una separación por capas técnicas reparte cada feature en tres o cuatro carpetas y hace que los agentes se pisen.

## Decisión

Organizar por **feature** y conservar las responsabilidades de MVC dentro de cada una:

- `app/api/**/route.ts` — Controller HTTP: valida, delega y traduce errores.
- `app/features/<área>/schema.ts` — Model/contrato Zod.
- `app/features/<área>/server/*-service.ts` — reglas de negocio y coordinación.
- `app/features/<área>/server/repository*.ts` — persistencia (puerto, memoria, Firestore).
- `app/features/container.ts` — raíz de composición.

Todo el código vive en `app/` (no hay `src/`). Las áreas son `accounts`, `contacts` y `alerts`; lo transversal va en `app/shared/`.

## Alternativas consideradas

- **MVC plano con `src/controllers`, `src/models`, `src/services`:** simple de explicar, pero una feature queda repartida y dos agentes editan la misma carpeta.
- **Lógica en las rutas:** más rápido, imposible de probar sin HTTP y mezcla seguridad con negocio.
- **Hexagonal completo:** ceremonia excesiva para el tamaño del proyecto.

## Consecuencias

- Cada feature se puede leer, probar y delegar de forma aislada.
- Hay un `schema.ts` por feature y solo el orquestador lo cambia.
- Las features no se importan entre sí: puertos declarados por el consumidor y conectados en el contenedor.
- Las fronteras se vigilan con `no-restricted-imports` en `npm run lint`.
