import { servicios, verificadorDeToken } from "@/features/container";
import { BorrarCuentaSchema, type Ok, type Sesion } from "@/shared/schema";
import { leerJson, manejar, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `DELETE /api/mi-cuenta` (spec A4, §3, R1–R8; criterios 1–10).
 *
 * Requiere `Authorization: Bearer <ID token>`; el `uid` borrado sale **solo**
 * del token verificado, nunca del cuerpo ni de la URL (R2). La sesión se exige
 * antes de leer el cuerpo: sin token la respuesta es `401` aunque falte la
 * confirmación. Después se valida `{ confirmar: "BORRAR" }` (R1): sin ese
 * literal exacto no se borra nada y se responde `400` con el campo `confirmar`.
 * El servicio borra Firestore y la cuenta de Auth; el resultado es
 * `200 { ok: true }` o un `500` opaco sin detalles (R6).
 */

export const runtime = "nodejs";

export const DELETE = manejar(async function borrarMiCuenta(peticion: Request): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  // Solo valida el cuerpo: la confirmación habilita el borrado y no viaja al servicio.
  await leerJson(peticion, BorrarCuentaSchema);
  const respuesta: Ok = await servicios.cuentas.borrarCuenta(sesion);
  return responderJson(respuesta, 200);
});
