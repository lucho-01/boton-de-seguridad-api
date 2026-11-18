import { servicios, verificadorDeToken } from "@/features/container";
import type { Sesion } from "@/shared/schema";
import { manejar, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `GET /api/auth/yo` (spec A1, §3, R10; criterios 12 y 13).
 *
 * Requiere `Authorization: Bearer <ID token>`. El `id` de la respuesta es el
 * `uid` verificado: nunca el cuerpo ni la URL.
 */

export const runtime = "nodejs";

export const GET = manejar(async function yo(peticion: Request): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const respuesta = await servicios.cuentas.yo(sesion);
  return responderJson(respuesta, 200);
});
