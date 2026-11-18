# ADR-0011 · Rol admin: verificación del claim y diagnóstico agregado

- **Estado:** Aceptada
- **Fecha:** 2026-11-16
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

El claim `rol` se asigna en A1 y la sesión ya lo expone (A0), pero ninguna ruta lo exigía. A5 debe demostrar el control de acceso por rol sin abrir administración de datos personales, que el documento de producto no contempla.

## Decisión

- **Una sola ruta:** `GET /api/admin/estado`, privada, que exige `rol = "admin"` en el token verificado. Sin el claim → `403`; sin token → `401`.
- **Respuesta agregada:** `{ cuentas, contactos, alertas }`, enteros `>= 0`, contados con consultas de agregación (`count`) sobre `usuarios`, `collectionGroup("contacto_confianza")` y `collectionGroup("alerta")`. Se incluyen los documentos con borrado lógico porque el diagnóstico mide volumen almacenado.
- **Sin datos personales:** no se listan correos, `uid`, teléfonos, coordenadas ni desglose por cuenta.
- **Sin autoascenso:** la API no crea ni modifica administradores. El primer `admin` se concede fuera de la API (consola de Firebase o Admin SDK).
- **Sin borrado de terceros:** A5 no añade ninguna ruta de administración sobre cuentas; A4 sigue siendo el único borrado y es autoborrado.
- **Aislamiento intacto:** el claim `admin` no cambia el filtrado por `uid` de A2/A3.

## Alternativas consideradas

- **Listar cuentas con correo y rol:** útil para soporte, pero expone datos personales y no está en el documento de producto. Rechazada.
- **Endpoint de bootstrap protegido por variable de entorno:** añade superficie pública y una segunda fuente de verdad para los roles. Rechazada.
- **Contar documentos uno a uno:** coste lineal y lecturas innecesarias; las consultas de agregación devuelven solo el número.

## Consecuencias

- La ruta sirve como verificación operativa del claim y como prueba de que `403` funciona sin él.
- **Residual aceptado:** `verifyIdToken` no usa `checkRevoked`, así que un administrador al que se le retira el claim conserva `rol = "admin"` hasta que caduque su ID token (~1 h). Es el mismo comportamiento que A1; cerrarlo requiere `verifyIdToken(token, true)` (una llamada extra a Firebase por petición) y una decisión de coste.
- A6 puede reutilizar el mismo patrón de sesión y de errores para el límite de intentos.
- Si más adelante la persona pide administración real, requiere spec nueva y reassessment de privacidad; este ADR no la autoriza.
