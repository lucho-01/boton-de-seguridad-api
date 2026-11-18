import { servicios } from "@/features/container";
import { type Refresh, RefreshSchema } from "@/shared/schema";
import { leerJson, manejar, responderJson } from "@/shared/server/http";

/**
 * `POST /api/auth/refresh` (spec A1, §3, R9; criterios 10 y 11).
 *
 * Público y solo JSON: rota el ID token y el refresh token. Un token
 * inválido, vencido o revocado responde 401.
 */

export const runtime = "nodejs";

export const POST = manejar(async function refrescar(peticion: Request): Promise<Response> {
  const datos: Refresh = await leerJson(peticion, RefreshSchema);
  const tokens = await servicios.cuentas.renovar(datos);
  return responderJson(tokens, 200);
});
