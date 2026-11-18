import { servicios, verificadorDeToken } from "@/features/container";
import { BuscarPorFechaSchema, type RespuestaContactos, type Sesion } from "@/shared/schema";
import { ErrorDeValidacion } from "@/shared/server/errors";
import { manejar, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `GET /api/contactos?since=<ISO>` (spec A2, §3, R10; criterios 11, 12 y 18).
 *
 * Requiere `Authorization: Bearer <ID token>`; el `uid` sale solo del token.
 * `since` opcional en ISO 8601 UTC: inválido o con otra zona → `400` con
 * `detalles[0].campo === "since"`, antes de tocar el servicio.
 */

export const runtime = "nodejs";

/** Valida la query y devuelve el cursor, o lanza 400 con el campo `since`. */
function leerSince(peticion: Request): string | undefined {
  const crudo = new URL(peticion.url).searchParams.get("since");
  const valor = crudo ?? undefined;
  const leido = BuscarPorFechaSchema.safeParse({ since: valor });
  if (leido.success) {
    return leido.data.since;
  }
  const motivo = leido.error.issues[0]?.message ?? "Fecha inválida";
  throw new ErrorDeValidacion([{ campo: "since", mensaje: motivo }]);
}

export const GET = manejar(async function listarContactos(peticion: Request): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const since = leerSince(peticion);
  const respuesta: RespuestaContactos = await servicios.contactos.listar(sesion, since);
  return responderJson(respuesta, 200);
});
