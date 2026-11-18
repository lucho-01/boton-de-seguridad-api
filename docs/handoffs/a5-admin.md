# Nota de entrega — A5 · Rol `admin` y ruta de diagnóstico

## Entrega: orquestador · A5

**Hecho**
- `GET /api/admin/estado` con Bearer y claim `rol = "admin"`.
- Respuesta `{ cuentas, contactos, alertas }` con totales agregados (consultas `count`, sin leer documentos).
- `403 "No tienes permiso para esta operación"` para `usuario`; `401` sin token.
- Sin autoascenso, sin listado de correos y sin borrado de terceros.
- 26 pruebas nuevas (469 en total), sin red ni Firebase.

**Archivos**
- Docs: `docs/specs/a5-admin.md`, `docs/adr/0011-admin-diagnostico.md`.
- Contrato: `app/shared/schema.ts` (`EstadoAdminSchema`).
- Backend: `app/features/accounts/server/admin-{service,repository,repository.memory,repository.firestore}.ts`, `app/api/admin/estado/route.ts`, `app/features/container.ts`.
- Pruebas: `app/features/accounts/tests/admin-service.test.ts`, `app/features/accounts/tests/admin-aislamiento.test.ts`, `app/api/tests/admin.test.ts`, `ia/pruebas/a5-admin.md`.

**Cómo verificar**
- `npm run check` → 469 pruebas en verde.
- `npm run build` → `ƒ /api/admin/estado`.
- Con token `admin`: `200` con los tres enteros; con token `usuario`: `403`.

**Decisiones**
- Se cuentan todos los documentos, incluidos los borrados lógicos: el diagnóstico mide volumen almacenado.
- El rol sale solo de la sesión verificada; el cuerpo/query no influyen.
- El primer `admin` se concede fuera de la API (consola de Firebase o Admin SDK).

**Pendiente / bloqueos**
- Persona: `.env`, Vercel y rotar la clave de servicio.
- A5 no añade borrado ni lectura de datos de terceros.

**Revisión de seguridad**
- **Aprobado con observaciones** (revisión conjunta A4 + A5 + A6). Sin hallazgos críticos ni altos.
- **Verificado:** el rol sale solo de `SesionSchema` construida desde `verifyIdToken`; la ruta no lee cuerpo, query ni cabeceras de rol; el `403` se emite antes de tocar Firestore; las pruebas cubren `?rol=admin`, `x-rol: admin`, Bearer inválido y 401 prioritario.
- **Verificado:** tres `count()` de agregación, respuesta validada con `EstadoAdminSchema` (enteros ≥ 0, sin claves extra) y pruebas de ausencia de correo, `uid`, teléfono, coordenadas y token.
- **Bajo — residual aceptado (ADR-0011):** `verifyIdToken` sin `checkRevoked`; al retirar el claim, el token antiguo conserva `admin` hasta ~1 h. Cerrarlo añade una llamada a Firebase por petición.
- **Informativo:** `npm audit` reporta moderadas solo en devDependencies; 0 en producción.
