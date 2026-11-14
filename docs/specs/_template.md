# Spec <id> · <nombre de la feature>

- **Estado:** Borrador | Aprobada
- **Feature:** <id y nombre de `docs/features.md`>
- **Fecha:** <YYYY-MM-DD>
- **Aprobada por:** <persona> el <YYYY-MM-DD>

## 1. Contexto y objetivo

Qué problema resuelve y para quién. Una frase con acción + resultado + objeto.

## 2. Alcance

- **Incluye:** …
- **No incluye:** …

## 3. Contrato HTTP

| Método y ruta | Entrada (campos y tipos) | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| … | … | código + cuerpo | código + clase de error |

Campos en `snake_case`, alineados con `schema.ts`.

## 4. Reglas de negocio

Cada regla comprobable, con números y estados. Sin «rápido» ni «amigable».

| # | Regla |
| --- | --- |
| R1 | … |

## 5. Autorización

Quién SÍ y quién NO. La identidad sale del ID token verificado. Aislamiento entre usuarios.

## 6. Validación y errores

Esquema Zod, límites, mensajes y códigos (400/401/403/404/409/413/415/429/500). Los 500 sin detalles.

## 7. Datos

Ruta de Firestore, campos y tipos, `created_at`/`updated_at`/`deleted_at`, índices necesarios.

## 8. Criterios de aceptación

1. Dado … cuando … entonces …
2. …

## 9. Pruebas previstas

Una por criterio, más bordes (0, 1, límite, límite + 1, vacío) y autorización.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | … | … | … |

## 11. Decisiones y dependencias

ADR nuevo si hace falta; ninguna dependencia sin justificación escrita.
