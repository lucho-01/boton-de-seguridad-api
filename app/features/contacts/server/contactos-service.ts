import {
  type Contacto,
  type ContactoEscritura,
  MAXIMO_PAGINA,
  type Ok,
  OkSchema,
  type RespuestaContactos,
  RespuestaContactosSchema,
  type Sesion,
} from "@/shared/schema";
import { Conflicto, NoEncontrado } from "@/shared/server/errors";
import { aIso, type Reloj } from "@/shared/server/time";
import { ConflictoDeContactos, type RepositorioContactos } from "./repository";

/**
 * Reglas de negocio de los contactos de confianza (spec A2, §4, §7, §8).
 *
 * El `uid` sale siempre de la sesión verificada; el `id` y el cuerpo los
 * valida la ruta con Zod (`IdRutaSchema`, `ContactoEscrituraSchema`) antes de
 * llegar aquí. El servicio recibe ya los datos con el contrato de escritura y
 * decide el tiempo con el reloj inyectado.
 *
 * Los mensajes 4xx son literales del dominio (R4, R5, R9) y no incluyen
 * teléfonos, nombres ni ids. Un fallo de almacén no se traduce: sube hasta
 * `manejar`, que responde `500` opaco y registra tipo y ubicación.
 */

/** Mensajes literales de los 409/404 de la spec A2 §6. */
export const MENSAJES_CONTACTO = {
  limite: "Máximo 5 contactos de confianza",
  telefono: "Ese teléfono ya está en tus contactos",
  noEncontrado: "Contacto no encontrado",
} as const;

/** Dependencias del servicio, todas inyectadas. */
export type DependenciasContactos = {
  repositorio: RepositorioContactos;
  reloj: Reloj;
};

/** Cara del servicio que usan las rutas. */
export type ServicioContactos = {
  listar(sesion: Sesion, since?: string): Promise<RespuestaContactos>;
  guardar(sesion: Sesion, id: string, datos: ContactoEscritura): Promise<Contacto>;
  borrar(sesion: Sesion, id: string): Promise<Ok>;
};

/** Traduce el rechazo del repositorio al 409 con el mensaje de la spec. */
function traducirConflicto(motivo: ConflictoDeContactos["motivo"]): Conflicto {
  if (motivo === "limite") {
    return new Conflicto(MENSAJES_CONTACTO.limite);
  }
  return new Conflicto(MENSAJES_CONTACTO.telefono);
}

/**
 * Parentesco normalizado (A2, R3): ausente o vacío tras recortar se guarda
 * como `null`. La longitud y el tipo ya los validó la frontera con Zod.
 */
function normalizarParentesco(parentesco: string | null | undefined): string | null {
  if (parentesco === undefined || parentesco === null) {
    return null;
  }
  const recortado = parentesco.trim();
  if (recortado.length === 0) {
    return null;
  }
  return recortado;
}

/** Crea el servicio con sus dependencias (spec A2, §4). */
export function crearServicioContactos(dependencias: DependenciasContactos): ServicioContactos {
  const { repositorio, reloj } = dependencias;

  async function listar(sesion: Sesion, since?: string): Promise<RespuestaContactos> {
    const cursor: string | null = since ?? null;
    const items = await repositorio.listar({
      uid: sesion.uid,
      since: cursor,
      limite: MAXIMO_PAGINA,
    });
    return RespuestaContactosSchema.parse({ items, servidor_ahora: aIso(reloj.ahora()) });
  }

  async function guardar(sesion: Sesion, id: string, datos: ContactoEscritura): Promise<Contacto> {
    try {
      return await repositorio.guardar(sesion.uid, {
        id,
        nombre: datos.nombre,
        telefono: datos.telefono,
        parentesco: normalizarParentesco(datos.parentesco),
        ahora: aIso(reloj.ahora()),
      });
    } catch (capturado) {
      if (capturado instanceof ConflictoDeContactos) {
        throw traducirConflicto(capturado.motivo);
      }
      throw capturado!;
    }
  }

  async function borrar(sesion: Sesion, id: string): Promise<Ok> {
    const borrado = await repositorio.borrarLogicamente(sesion.uid, id, aIso(reloj.ahora()));
    if (borrado === null) {
      throw new NoEncontrado(MENSAJES_CONTACTO.noEncontrado);
    }
    return OkSchema.parse({ ok: true });
  }

  return { listar, guardar, borrar };
}
