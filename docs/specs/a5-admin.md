# Spec A5 · Rol `admin` y ruta de diagnóstico

- **Estado:** Aprobada
- **Feature:** A5 (ver `docs/features.md`)
- **Fecha:** 2026-11-16
- **Aprobada por:** la persona el 2026-11-16

## 1. Contexto y objetivo

La API ya distingue el rol desde el claim `rol` del token (A0/A1), pero todavía no existe ninguna ruta que lo use. A5 **cierra el control de acceso por rol**: una ruta de diagnóstico que solo responde a una cuenta con claim `admin` y devuelve totales agregados del sistema, sin exponer datos de ninguna persona. Sirve además como prueba viva de que sin el claim la API responde `403`.

## 2. Alcance

- **Incluye:** `GET /api/admin/estado` con Bearer y claim `rol = "admin"`; totales agregados de cuentas, contactos y alertas; `403` para cualquier usuario sin el claim; pruebas con dobles.
- **No incluye:** listar cuentas o correos, borrar cuentas ajenas, cambiar roles desde la API, panel web, auditoría persistida, métricas por usuario, exportaciones. El primer `admin` se concede **fuera de la API** (consola de Firebase o Admin SDK), nunca por autoascenso.

## 3. Contrato HTTP

| Método y ruta | Entrada | Respuesta feliz | Errores |
| --- | --- | --- | --- |
| `GET /api/admin/estado` | Bearer con claim `rol = "admin"` | `200 { cuentas: 3, contactos: 12, alertas: 40 }` | `401` sin sesión o token inválido · `403` autenticado sin claim `admin` · `500` fallo al contar |

Los tres números son enteros `>= 0`. No hay cuerpo de petición ni query.

## 4. Reglas de negocio

| # | Regla |
| --- | --- |
| R1 | La ruta exige un ID token válido y el claim `rol = "admin"`, leído del token verificado. Sin claim o con `rol = "usuario"` → `403 "No tienes permiso para esta operación"`. |
| R2 | El rol **nunca** se lee del cuerpo, de la query ni de la URL; solo de la sesión derivada del token (A0). |
| R3 | La respuesta son solo **totales agregados**: número de documentos `usuarios`, de documentos en la colección `contacto_confianza` y de documentos en `alerta` (todos los usuarios, incluidos los borrados lógicos). No incluye correos, `uid`, teléfonos, coordenadas ni desglose por persona. |
| R4 | La API no permite crear, ascender ni degradar administradores. El claim se concede fuera de la API; A5 solo lo verifica. |
| R5 | Ningún `admin` puede borrar ni leer datos privados de otra persona en A5. El único borrado sigue siendo `DELETE /api/mi-cuenta` (A4, autoborrado). |
| R6 | Los errores conservan el formato uniforme de A0: `401`, `403` y `500` opaco (`{ "error": "Error interno" }`). |
| R7 | Ni los logs ni la respuesta incluyen datos personales; un fallo de conteo solo registra tipo y ubicación. |

## 5. Autorización

- `GET /api/admin/estado` es privada y **solo para `admin`**.
- `usuario` autenticado → `403`; sin token → `401` (el `401` tiene prioridad).
- El rol `admin` no cambia el resto de la API: un admin sigue viendo solo sus propios contactos y alertas, y solo puede borrarse a sí mismo.

## 6. Validación y errores

| Caso | Respuesta |
| --- | --- |
| Sin `Authorization` o token inválido | `401` de A0 |
| Token válido con `rol = "usuario"` | `403 "No tienes permiso para esta operación"` |
| Token válido con `rol = "admin"` y conteo correcto | `200 { cuentas, contactos, alertas }` |
| Fallo de Firestore al contar | `500 { "error": "Error interno" }` |

No hay cuerpo que validar con Zod en la petición; la respuesta se valida con `EstadoAdminSchema` antes de salir del servicio.

## 7. Datos

```text
usuarios/*                                  → cuentas
collectionGroup("contacto_confianza")/*     → contactos
collectionGroup("alerta")/*                 → alertas
```

- Se usan consultas de agregación (`count`) del Admin SDK; no se leen documentos completos.
- No se añaden índices: no hay filtros ni orden.
- Los conteos incluyen documentos con borrado lógico (miden volumen almacenado, no datos vigentes).

## 8. Criterios de aceptación

1. Dado un token con `rol = "admin"`, entonces `200` con `{ cuentas, contactos, alertas }` enteros `>= 0` que coinciden con los dobles.
2. Dado un token con `rol = "usuario"` o sin claim, entonces `403` y no se consulta Firestore.
3. Sin token → `401`.
4. El servicio nunca lee el rol del cuerpo ni de la query.
5. Un fallo del repositorio → `500 { "error": "Error interno" }` sin detalles.
6. La respuesta no contiene correos, `uid`, teléfonos ni coordenadas.
7. Un `admin` sigue viendo solo sus propios contactos y alertas en A2/A3 (sin cambios en esas rutas).
8. Un `admin` puede borrar su propia cuenta con A4; no existe ruta para borrar la de otro.

## 9. Pruebas previstas

- Servicio: admin ve totales, usuario → 403 sin llamar al repositorio, fallo del repositorio → 500, y el rol sale solo de la sesión.
- Ruta real `GET /api/admin/estado` con dobles: `200`, `403`, `401`, `500` opaco.
- Regresión: A2/A3 no cambian su aislamiento para un token `admin`.
- Cero red y cero Firebase.

## 10. Preguntas abiertas

| # | Pregunta | Propuesta | Respuesta de la persona |
| --- | --- | --- | --- |
| 1 | ¿Qué incluye A5? | Ruta de diagnóstico con totales, sin datos personales | **Ruta de diagnóstico con totales** |
| 2 | ¿Cómo se crea el primer admin? | Fuera de la API (consola/Admin SDK) | **Fuera de la API** |
| 3 | ¿Un admin puede borrar cuentas ajenas? | No; solo autoborrado de A4 | **No, solo autoborrado** |
| 4 | ¿Los totales incluyen borrados lógicos? | Sí: miden volumen almacenado | **Sí (decisión de diseño)** |

## 11. Decisiones y dependencias

- Sin dependencias nuevas.
- ADR nuevo: **ADR-0011 · Rol admin: verificación del claim y diagnóstico agregado**.
- Se reutilizan `requiereSesion`, `ErrorDeDominio` y el formato de errores de A0; la sesión ya expone `rol`.
