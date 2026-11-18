import { servicios, verificadorDeToken } from "@/features/container";
import {
  type Contacto,
  type ContactoEscritura,
  ContactoEscrituraSchema,
  IdRutaSchema,
  type Ok,
  type Sesion,
} from "@/shared/schema";
import { NoEncontrado } from "@/shared/server/errors";
import { leerJson, manejarConContexto, responderJson } from "@/shared/server/http";
import { requiereSesion } from "@/shared/server/session";

/**
 * `PUT /api/contactos/<id>` y `DELETE /api/contactos/<id>` (spec A2, §3).
 *
 * El `id` es un UUID generado por el cliente; si no lo es, la ruta es
 * inexistente → `404` (nunca `400`). En Next 16 los `params` de una ruta
 * dinámica son una promesa, así que el handler recibe
 * `{ params: Promise<{ id: string }> }` y `manejarConContexto` traduce los
 * fallos igual que `manejar`.
 */

export const runtime = "nodejs";

/** Contexto de la ruta dinámica de Next 16 (`params` es una promesa). */
type ContextoRuta = { params: Promise<{ id: string }> };

/** Devuelve el `id` si es UUID; si no, lanza `404` (ruta inexistente). */
function leerId(id: string): string {
  const leido = IdRutaSchema.safeParse(id);
  if (!leido.success) {
    throw new NoEncontrado();
  }
  return leido.data;
}

export const PUT = manejarConContexto(async function guardarContacto(
  peticion: Request,
  contexto: ContextoRuta,
): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const { id } = await contexto.params;
  const identidad = leerId(id);
  const datos: ContactoEscritura = await leerJson(peticion, ContactoEscrituraSchema);
  const guardado: Contacto = await servicios.contactos.guardar(sesion, identidad, datos);
  return responderJson(guardado, 200);
});

export const DELETE = manejarConContexto(async function borrarContacto(
  peticion: Request,
  contexto: ContextoRuta,
): Promise<Response> {
  const sesion: Sesion = await requiereSesion(peticion, verificadorDeToken);
  const { id } = await contexto.params;
  const identidad = leerId(id);
  const resultado: Ok = await servicios.contactos.borrar(sesion, identidad);
  return responderJson(resultado, 200);
});
