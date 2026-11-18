import { servicios, verificadorDeToken } from "@/features/container";
import type { Sesion } from "@/shared/schema";
import { manejar, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `GET /api/admin/estado` (spec A5, §3, §5; ADR-0011).
 *
 * Requiere `Authorization: Bearer <ID token>` con el claim `rol = "admin"`.
 * Sin token o con token inválido → `401`; autenticado sin el claim → `403`
 * (el servicio lo decide antes de consultar Firestore). La respuesta son solo
 * totales agregados, nunca datos personales.
 */

export const runtime = "nodejs";

export const GET = manejar(async function estadoAdmin(peticion: Request): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const respuesta = await servicios.admin.estado(sesion);
  return responderJson(respuesta, 200);
});
