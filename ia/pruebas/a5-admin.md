# Evidencia A5 · Rol `admin` y diagnóstico

- **Fecha:** 2026-11-16
- **Spec:** `docs/specs/a5-admin.md` §8 criterios 1–8
- **Comando:** `npm run check`
- **Resultado:** formato + lint + tipos + pruebas en verde · **469 pruebas / 18 archivos**.

## Archivos nuevos de pruebas

| Archivo | Qué demuestra |
| --- | --- |
| `app/features/accounts/tests/admin-service.test.ts` | `admin` devuelve totales exactos y consulta el repositorio una vez; `usuario`/sin claim → 403 sin consultar; fallo → 500 opaco; el rol sale solo de la sesión; los totales se validan (enteros ≥ 0). |
| `app/api/tests/admin.test.ts` | Ruta real `GET /api/admin/estado`: 200 con totales, 403, 401 (sin token / token inválido), 500 opaco sin detalles y respuesta sin datos personales. |
| `app/features/accounts/tests/admin-aislamiento.test.ts` | Regresión A2/A3: un `admin` solo ve y borra sus propios contactos/alertas y su resumen. |

## Restricciones de la IA respetadas

- Cero red y cero Firebase: el contenedor se sustituye con `vi.mock` y los servicios usan repositorios en memoria.
- Cero `any`/`unknown`, sin ternarios ni casts; tiempo inyectado con un reloj fijo.
- No se modificó ninguna prueba existente ni código de producción.

## Reproducir

```bash
npx vitest run app/features/accounts/tests/admin-service.test.ts \
  app/api/tests/admin.test.ts \
  app/features/accounts/tests/admin-aislamiento.test.ts
```
