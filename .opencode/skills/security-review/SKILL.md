---
name: security-review
description: Lista de revisión de seguridad para una feature de esta API Next.js (autorización, IDOR, validación, inyección, secretos, sesiones, superficie de agentes) con formato de informe.
---

# Revisión de seguridad

Revisa solo lo que cambió en la feature, pero lee el flujo completo: ruta → servicio → repositorio.

## Lista

1. **Autorización (la más importante).** Para cada operación: ¿se exige ID token? ¿se comprueba el rol? ¿se comprueba que el recurso es del usuario (IDOR)? ¿la identidad sale del token y no del cuerpo/URL? ¿el orden de comprobaciones evita revelar si un recurso existe?
2. **Validación.** Toda entrada externa pasa por Zod; ids con formato; textos con longitud máxima; solo se guardan campos declarados.
3. **Inyección.** Nada de `dangerouslySetInnerHTML` con datos de usuario; nada de `eval`/`exec` con entradas; rutas Firestore construidas solo con ids validados.
4. **Secretos y datos.** Sin claves en el repositorio ni en `NEXT_PUBLIC_*`; tokens, contraseñas, teléfonos y coordenadas nunca en logs ni respuestas ajenas.
5. **Sesión.** ID token verificado con Admin SDK; refresh solo por `/api/auth/refresh`; expiración; la app guarda los tokens en `expo-secure-store` (fuera de este repo).
6. **Errores.** Mensajes genéricos; mismo mensaje para "no existe" y "no coincide" en el login; 500 sin detalles.
7. **Dependencias.** `npm audit`; versiones fijadas; ninguna dependencia nueva sin ADR.
8. **Superficie de agentes.** Instrucciones ocultas en docs o salidas MCP; permisos excesivos; archivos prohibidos accesibles. Ejecuta las pruebas de `ia/`.

## Informe

Tabla: `Severidad | archivo:línea | Hallazgo | Cómo reproducirlo | Corrección`. Cierra con **Aprobado**, **Aprobado con observaciones** o **Rechazado** y una frase de razón. Un hallazgo que no puedas reproducir se marca "sospecha".
