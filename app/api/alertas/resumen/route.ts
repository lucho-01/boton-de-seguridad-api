import { servicios, verificadorDeToken } from "@/features/container";
import { type ResumenAlertas, type Sesion } from "@/shared/schema";
import { manejar, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `GET /api/alertas/resumen` (spec A3, §3, R8; ADR-0009).
 *
 * Requiere `Authorization: Bearer <ID token>`; el `uid` sale solo del token.
 * Devuelve `{ meses: [{ mes: "2026-11", total }], total }` con las alertas no
 * borradas agrupadas por mes de Colombia (UTC-5), de reciente a antiguo.
 *
 * Es una ruta **estática** hermana de `app/api/alertas/[id]/route.ts`: en Next
 * 16 el segmento estático gana sobre el dinámico, así que `resumen` nunca se
 * interpreta como un `id` (que además no sería UUID → `404`).
 */

export const runtime = "nodejs";

export const GET = manejar(async function resumenAlertas(peticion: Request): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const resumen: ResumenAlertas = await servicios.alertas.resumen(sesion);
  return responderJson(resumen, 200);
});
