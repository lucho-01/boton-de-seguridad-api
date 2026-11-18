# Nota de entrega — A4 · Borrar mi cuenta y todos mis datos

## Entrega: orquestador · A4

**Hecho**
- `DELETE /api/mi-cuenta` con Bearer y confirmación literal `{ "confirmar": "BORRAR" }`.
- Borrado físico de `usuarios/{uid}` y sus subcolecciones `contacto_confianza` y `alerta` con `recursiveDelete`, y después de la cuenta de Firebase Auth.
- Orden e idempotencia: Firestore → Auth; `USER_NOT_FOUND` en Auth es éxito; cualquier otro fallo responde 500 opaco y el reintento completa.
- 31 pruebas nuevas (443 en total), sin red ni Firebase.

**Archivos**
- Docs: `docs/specs/a4-borrar-cuenta.md`, `docs/adr/0010-borrado-cuenta.md`.
- Contrato: `app/shared/schema.ts` (`BorrarCuentaSchema`).
- Backend: `app/features/accounts/server/{repository,repository.memory,repository.firestore,cuentas-service}.ts`, `app/api/mi-cuenta/route.ts`.
- Pruebas: `app/features/accounts/tests/cuentas-service.test.ts` (bloque A4), `app/api/tests/mi-cuenta.test.ts`.

**Cómo verificar**
- `npm run check` → 443 pruebas, formato, lint y tipos en verde.
- `npm run build` → `ƒ /api/mi-cuenta`.
- `DELETE /api/mi-cuenta` con `{ "confirmar": "BORRAR" }` y Bearer → `200 { ok: true }`; sin el literal → `400` con `campo: "confirmar"`.

**Decisiones**
- El cuerpo solo habilita la operación: el `uid` sale del token verificado.
- Primero Firestore y después Auth: si Auth falla, la cuenta queda vacía pero el reintento la elimina; al revés dejaría datos huérfanos sin forma de reintentar autenticado.
- Los totales/conteos no se exponen; la respuesta es solo `{ ok: true }`.
- Sin periodo de gracia ni confirmación de contraseña (decisión de la persona).

**Pendiente / bloqueos**
- **Riesgo aceptado** (ADR-0010): el ID token emitido sigue siendo válido hasta ~1 h tras el borrado; no puede renovarse ni volver a iniciar sesión. Se puede cerrar con `checkRevoked` o un tombstone en A6.
- Persona: `.env`, Vercel y rotar la clave de servicio.
- A5 hereda el mismo orden de borrado si algún día añade borrado administrativo (hoy no lo hace).

**Revisión de seguridad**
- **Aprobado con observaciones.** Informe del agente `security` (solo lectura):
  - **Bajo — riesgo aceptado (R9/ADR-0010)**: el ID token sigue válido ≤1 h tras el borrado y, al ignorar el Admin SDK las `firestore.rules`, podría recrear contactos/alertas bajo el `uid` borrado. No hay exposición a terceros ni reutilización del `uid`; mitigación opcional (`checkRevoked` solo en escrituras o un tombstone) documentada para A6.
  - **Bajo — pendiente de prueba**: falta una aserción de que el log de fallo de Auth no contiene correo ni `uid`. Se pide al agente `tests`.
  - **Informativo**: el borrado de subcolecciones con `recursiveDelete` se verifica por inspección; probarlo requiere el emulador de Firestore.
  - **Informativo**: `npm audit` reporta 7 moderadas solo en la cadena de ESLint (0 high/critical, 0 en producción); A4 no añade dependencias.
  - Limpios: identidad/IDOR, orden Firestore→Auth, 500 opacos, validación 400/413/415, logs sin datos personales, regresiones A0–A3 y rollback del registro.

**Estado final:** `npm run check` → **443 pruebas** en verde; `npm run build` compila `/api/mi-cuenta`.
