# Arquitectura de la API

Organización **por feature** (FDD): el código se agrupa por lo que la API hace, no por tipo de archivo. Decisión en `docs/adr/0001-arquitectura-por-features.md`.

## Mapa del proyecto

Todo el código vive en `app/` (no hay `src/`). El andamiaje de la API existe desde A0 (`docs/specs/a0-base.md`); las carpetas de cada feature se crean al construirla.

```text
app/
  api/…/route.ts           Controller HTTP: valida con Zod, llama al servicio y traduce errores
  features/
    container.ts           Raíz de composición: conecta repositorios y servicios
    <área>/
      schema.ts              Contrato Zod (solo lo cambia el orquestador)
      server/
        *-service.ts         Reglas de negocio
        repository.ts        Puertos (interfaces) y tipos
        repository.memory.ts Implementación en memoria (pruebas)
        repository.firestore.ts Implementación real (Admin SDK, valida cada documento con Zod)
      tests/                 Pruebas de la feature (Vitest)
  shared/
    schema.ts              Contrato común (roles, errores)
    server/                Errores, HTTP, entorno, Firebase Admin, sesión/token
    tests/                 Pruebas de lo común
tests/                     Punto de entrada de Vitest (ayudantes y pruebas de proyecto)
ia/                        Configuración de IA: bitácora y pruebas de las restricciones
.opencode/                 Agentes, skills, plugin y reglas del guard
docs/                      Producto, features, specs, ADRs, notas de entrega
```

`features/` y `shared/` no contienen `page` ni `route`, así que Next no las trata como rutas.

## Flujo de una petición

```text
App móvil ──▶ route.ts ──▶ servicio ──▶ repositorio ──▶ Firestore
              valida (Zod)  reglas        solo guarda
              traduce       de negocio    y consulta
              errores
```

La ruta obtiene el servicio de `@/features/container`; nunca construye repositorios ni importa el `server/` de una feature.

## Fronteras (las vigila `npm run lint`)

| Desde | Puede importar | No puede importar |
| --- | --- | --- |
| `shared/**` | `shared/**` | `features/` |
| `features/x/schema.ts` | `shared/schema` | `server/`, el contenedor |
| `features/x/server/**` | su propia feature (relativo), `shared/`, `schema.ts` de otras | `ui/`, el contenedor, el `server/` de otra feature, `next/server` |
| rutas (`app/api/**`) | `features/container`, `shared/`, `features/*/schema` | `features/*/server/`, `firebase-admin` |

**Comunicación entre features.** Cuando una feature necesita algo de otra, declara un **puerto propio** con lo mínimo que usa y la otra lo cumple por estructura; `app/features/container.ts` los conecta.

## Patrones

| Patrón | Dónde | Para qué |
| --- | --- | --- |
| Repository | `app/features/*/server/repository*.ts` | Cambiar Firestore por memoria (pruebas) sin tocar servicios |
| Service layer | `app/features/*/server/*-service.ts` | Un lugar para cada regla de negocio |
| Dependency Injection | `createXService(deps)` | Servicios probables y sin globales |
| Ports (consumidor) | el `repository.ts` de la feature que consume | Desacoplar features |
| Contratos Zod primero | `app/features/*/schema.ts`, `app/shared/schema.ts` | Rutas, servicios y pruebas dependen del mismo acuerdo |

## Sincronización

- La app escribe primero en SQLite (`pending = 1`) y luego envía los pendientes.
- `GET ?since=<ISO>` trae cambios (máx. 500), incluidos los borrados lógicos, y `servidor_ahora`.
- `PUT /<id>` es idempotente: el UUID lo genera el cliente y es el mismo en SQLite y Firestore.
- `DELETE` marca `deleted_at`; nunca borra físicamente.
- Conflictos: gana la última escritura según `updated_at` del servidor.

Detalle en `docs/adr/0003-sincronizacion-idempotente.md`.

## Entorno y secretos

`app/shared/server/env.ts` valida las variables con Zod y es el único lugar que lee `process.env`. Los clientes de Firebase se crean de forma perezosa en `app/shared/server/firebase.ts`. Ningún módulo imprime valores.

## Configuración de IA

Ver `docs/adr/0005-configuracion-de-agentes.md`: OpenCode con agentes por zona, permisos en `opencode.json`, guard en `.opencode/guard/` y evidencias en `ia/`.
