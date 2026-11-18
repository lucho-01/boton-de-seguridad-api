# ADR-0009 · Alertas: ubicación opcional, hora de origen y resumen mensual

- **Estado:** Aceptada
- **Fecha:** 2026-11-14
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

A3 guarda el historial de alertas que la app genera sin conexión. Cada alerta puede carecer de GPS, llega con la hora en que ocurrió (no la de sincronización) y la persona quiere ver cuántas hubo por mes. La API no envía SMS ni llamadas.

## Decisión

- **Ruta Firestore:** `usuarios/{uid}/alerta/{id}`, con el `uid` del token.
- **Ubicación opcional pero coherente:** `lat`, `lng` y `precision_m` llegan todos o ninguno; si llegan, se validan rangos (`[-90, 90]`, `[-180, 180]`, `[0, 100 000]`). Parcial → 400.
- **`creada_en` es la fuente de verdad temporal**: la pone la app (cuándo pulsó el botón) y debe quedar entre `2026-01-01T00:00:00.000Z` y 5 minutos después del reloj del servidor. El servidor añade `created_at`/`updated_at`/`deleted_at` como en ADR-0003.
- **Resumen por mes en horario de Colombia (UTC-5, sin horario de verano)**: se agrupa por `creada_en` convertida a UTC-5, cuentan ambos estados (`cancelada` y `mensaje_preparado`), se excluyen borrados lógicos y se devuelven solo los meses con total > 0, de reciente a antiguo, sin tope.
- **Sincronización y borrado:** mismo patrón que A2 (`GET ?since`, `PUT` idempotente, `DELETE` lógico con 404 al repetir).
- **Sin límite** de alertas por cuenta.
- **Índices:** `alerta(updated_at ASC)` y `alerta(creada_en DESC)`, ya en `firestore.indexes.json`.

## Alternativas consideradas

- **Mes en UTC:** el documento de producto habla de la persona (Colombia); el corte en UTC movería a otro mes las alertas de la noche del último día. Rechazada por la persona.
- **Agrupar por `created_at`:** un período sin conexión cambiaría el mes de las alertas. Rechazada.
- **Guardar el mes ya calculado en el documento:** duplica la regla y complica cambios de huso. Rechazada.
- **Resumen en el cliente:** la app ya puede hacerlo, pero el requisito RF-A3 pide que la API lo entregue; además sirve como prueba de que la sincronización funciona.

## Consecuencias

- El cálculo del mes es una función pura (fecha UTC → `YYYY-MM` en UTC-5) que se prueba sin Firestore.
- Un cambio futuro de huso o de regla del resumen exige migrar datos o recalcular (no se persiste el mes).
- **Cota mínima de `creada_en` (2026-01-01)**: además de evitar fechas absurdas que inflaban el resumen, cierra el hallazgo alto de seguridad (un dato con año `0000` rompía el resumen con 500 permanente). `mesEnColombia` acota por defensa en profundidad los documentos heredados.
- **Riesgo aceptado (bajo, hallazgo de seguridad)**: el resumen lee todas las alertas no borradas de la cuenta; con decenas de miles de alertas es coste de lectura por petición. Se puede mitigar en A6 (límite de escrituras) o cacheando el resumen por `updated_at`.
- A4 deberá borrar la subcolección `alerta`.
