import { servicios } from "@/features/container";
import { type Registro, RegistroSchema } from "@/shared/schema";
import { leerJson, manejar, responderJson } from "@/shared/server/http";

/**
 * `POST /api/auth/registro` (spec A1, §3; criterio 1).
 *
 * Público y solo JSON. La ruta valida con Zod, delega en el servicio y
 * responde `201` con los tokens y el usuario. Los errores (400, 409, 415,
 * 500) los traduce `manejar` desde los errores de dominio.
 */

export const runtime = "nodejs";

export const POST = manejar(async function registro(peticion: Request): Promise<Response> {
  const datos: Registro = await leerJson(peticion, RegistroSchema);
  const cuenta = await servicios.cuentas.registrar(datos);
  return responderJson(cuenta, 201);
});
