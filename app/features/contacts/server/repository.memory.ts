import type { Contacto } from "@/shared/schema";
import {
  ConflictoDeContactos,
  type DatosGuardado,
  type ListarContactos,
  type RepositorioContactos,
} from "./repository";

/**
 * Repositorio de contactos en memoria (spec A2, §9; ADR-0008).
 *
 * Replica las reglas del repositorio real sin Firestore: cada instancia es un
 * mapa `uid → (id → contacto)`, así que dos pruebas nunca comparten estado.
 * `guardar` comprueba límite y unicidad antes de escribir (**última
 * barrera**, igual que la transacción de Firestore) y `listar` ordena por
 * `updated_at` ascendente y acota a `limite`.
 */

/** Orden estable por `updated_at` y, a igualdad, por `id`. */
function compararPorUpdatedAt(a: Contacto, b: Contacto): number {
  if (a.updated_at < b.updated_at) {
    return -1;
  }
  if (a.updated_at > b.updated_at) {
    return 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

/** `true` si otro contacto activo de la cuenta ya usa el teléfono (R5). */
function telefonoOcupado(contactos: Iterable<Contacto>, datos: DatosGuardado): boolean {
  for (const contacto of contactos) {
    if (contacto.id === datos.id) {
      continue;
    }
    if (contacto.deleted_at !== null) {
      continue;
    }
    if (contacto.telefono === datos.telefono) {
      return true;
    }
  }
  return false;
}

/** Número de contactos activos de la cuenta (R4). */
function contarActivos(contactos: Iterable<Contacto>): number {
  let total = 0;
  for (const contacto of contactos) {
    if (contacto.deleted_at === null) {
      total += 1;
    }
  }
  return total;
}

/** Constructor del doble: un mapa privado por instancia. */
export function crearRepositorioContactosEnMemoria(): RepositorioContactos {
  const cuentas = new Map<string, Map<string, Contacto>>();

  /** Mapa de la cuenta; se crea la primera vez que aparece su `uid`. */
  function contactosDe(uid: string): Map<string, Contacto> {
    const existente = cuentas.get(uid);
    if (existente !== undefined) {
      return existente;
    }
    const nuevo = new Map<string, Contacto>();
    cuentas.set(uid, nuevo);
    return nuevo;
  }

  /**
   * Escribe el documento aplicando R4/R5/R6/R7. Se resuelve entero de forma
   * síncrona: ningún `await` entre la comprobación y la escritura.
   */
  function escribir(uid: string, datos: DatosGuardado): Contacto {
    const contactos = contactosDe(uid);
    const previo = contactos.get(datos.id);
    const estabaActivo = previo !== undefined && previo.deleted_at === null;
    // R4 cuenta los activos que quedan tras la escritura: restaurar un borrado
    // no puede añadir el 6.º cuando otro contacto ocupó su hueco.
    let otrosActivos = contarActivos(contactos.values());
    if (estabaActivo) {
      otrosActivos -= 1;
    }
    if (!estabaActivo && otrosActivos >= 5) {
      throw new ConflictoDeContactos("limite");
    }
    if (telefonoOcupado(contactos.values(), datos)) {
      throw new ConflictoDeContactos("telefono");
    }
    const creadoEn = previo?.created_at ?? datos.ahora;
    const documento: Contacto = {
      id: datos.id,
      nombre: datos.nombre,
      telefono: datos.telefono,
      parentesco: datos.parentesco,
      created_at: creadoEn,
      updated_at: datos.ahora,
      deleted_at: null,
    };
    contactos.set(datos.id, documento);
    return { ...documento };
  }

  return {
    async listar(peticion: ListarContactos): Promise<Contacto[]> {
      const contactos = cuentas.get(peticion.uid) ?? new Map<string, Contacto>();
      const filtrados: Contacto[] = [];
      for (const contacto of contactos.values()) {
        if (peticion.since !== null && contacto.updated_at <= peticion.since) {
          continue;
        }
        filtrados.push({ ...contacto });
      }
      filtrados.sort(compararPorUpdatedAt);
      return filtrados.slice(0, peticion.limite);
    },

    async obtener(uid: string, id: string): Promise<Contacto | null> {
      const contacto = cuentas.get(uid)?.get(id);
      if (contacto === undefined) {
        return null;
      }
      return { ...contacto };
    },

    async guardar(uid: string, datos: DatosGuardado): Promise<Contacto> {
      return escribir(uid, datos);
    },

    async borrarLogicamente(uid: string, id: string, ahora: string): Promise<Contacto | null> {
      const contactos = cuentas.get(uid);
      if (contactos === undefined) {
        return null;
      }
      const previo = contactos.get(id);
      if (previo === undefined) {
        return null;
      }
      if (previo.deleted_at !== null) {
        return null;
      }
      const borrado: Contacto = { ...previo, deleted_at: ahora, updated_at: ahora };
      contactos.set(id, borrado);
      return { ...borrado };
    },
  };
}
