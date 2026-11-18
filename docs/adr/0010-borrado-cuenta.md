# ADR-0010 · Borrado de cuenta: orden, idempotencia y tokens vigentes

- **Estado:** Aceptada
- **Fecha:** 2026-11-16
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

A4 permite que la persona borre su cuenta y todos sus datos. Los datos privados viven en un subárbol de Firestore (`usuarios/{uid}` con `contacto_confianza` y `alerta`) y la identidad vive en Firebase Auth. Ambos almacenes no comparten transacción, así que hay que decidir el orden, qué pasa si un paso falla y qué ocurre con el ID token que ya estaba emitido.

## Decisión

- **Ruta y confirmación:** `DELETE /api/mi-cuenta` con Bearer y `{ "confirmar": "BORRAR" }`. Sin el literal exacto no se borra nada (`400`).
- **Identidad:** el `uid` sale solo del token verificado; el cuerpo no puede elegir la cuenta.
- **Orden:** primero Firestore (borrado recursivo de `usuarios/{uid}`, que incluye el documento y las subcolecciones `contacto_confianza` y `alerta`) y después `deleteUser(uid)` en Firebase Auth.
- **Idempotencia:** un reintento vuelve a borrar lo que quede. Si Auth responde `USER_NOT_FOUND`, se considera éxito. `recursiveDelete` y `deleteUser` son seguros al repetirse.
- **Respuesta:** `200 { ok: true }` solo cuando ambos pasos terminaron (o ya no había nada). Cualquier otro fallo → `500 "Error interno"` opaco; la persona reintenta.
- **Sin periodo de gracia, sin exportación y sin pedir contraseña:** el Bearer es la prueba de identidad y el borrado es inmediato.
- **Logs:** solo tipo de fallo y ubicación; nunca correo, `uid`, tokens, teléfonos ni coordenadas.

## Alternativas consideradas

- **Borrar Auth primero:** si Firestore falla después, la cuenta ya no existe y los datos quedan huérfanos sin forma de reintentar autenticado. Rechazada.
- **Borrado lógico o periodo de gracia de 30 días:** exige cron, estado adicional y un tombstone; la persona pidió borrado inmediato. Rechazada.
- **Transacción única Firestore + Auth:** imposible entre dos sistemas; el orden elegido minimiza el daño de un fallo parcial.
- **`checkRevoked: true` en cada `verifyIdToken`:** cerraría el uso del token tras el borrado, a cambio de una consulta extra a Firebase en cada petición de toda la API. Se pospone a A5/A6 si la persona lo pide.

## Consecuencias

- Si Firestore falla antes de borrar nada, la cuenta queda intacta y el reintento funciona.
- Si Auth falla después de borrar los datos, la cuenta sigue existiendo pero vacía; el reintento solo ejecuta el borrado de Auth.
- **Riesgo aceptado:** el ID token emitido sigue siendo válido hasta ~1 h después del borrado (Firebase no lo revoca al borrar al usuario, salvo que se use `checkRevoked`). La cuenta no puede renovarlo ni volver a iniciar sesión, pero ese token podría recrear datos bajo el `uid` borrado. Se documenta aquí y se puede cerrar en A6 con `checkRevoked` o con un tombstone si el riesgo deja de ser aceptable.
- A5 y A6 heredan este orden: cualquier borrado administrativo debe reutilizar el mismo servicio.
