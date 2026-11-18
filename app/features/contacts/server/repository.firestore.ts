import { getFirestore } from "firebase-admin/firestore";
import type { Transaction } from "firebase-admin/firestore";
import { type Contacto, ContactoSchema } from "@/shared/schema";
import { obtenerApp } from "@/shared/server/firebase";
import {
  ConflictoDeContactos,
  type DatosGuardado,
  type ListarContactos,
  type RepositorioContactos,
} from "./repository";

/**
 * Repositorio de contactos en Firestore (spec A2, §7; ADR-0008).
 *
 * Ruta `usuarios/{uid}/contacto_confianza/{id}`. Cada documento leído se valida
 * con `ContactoSchema` antes de salir del repositorio. `guardar` corre en una
 * transacción con todas las lecturas antes de la escritura (ADR-0003), de modo
 * que dos `PUT` simultáneos no crean el 6.º ni duplican un teléfono. Nunca se
 * registra el nombre ni el teléfono: los logs solo dicen tipo y ubicación.
 */

/** Colección de contactos dentro de `usuarios/{uid}`. */
export const COLECCION_CONTACTOS = "contacto_confianza";

/** Máximo de contactos activos por cuenta (R4). */
const MAXIMO_ACTIVOS = 5;

/** Forma del documento en Firestore: el contrato sin el `id` (va en la ruta). */
const ContactoDocumentoSchema = ContactoSchema.omit({ id: true });

/** Snapshot mínimo que necesita `previoDe`: existencia y datos. */
type SnapshotDeDocumento = {
  exists: boolean;
  data(): object | undefined;
};

/** Log de un fallo de Firestore: tipo y ubicación, nunca datos del documento. */
function registrarFallo(ubicacion: string, fallo: object): void {
  const tipo = describirTipo(fallo);
  console.error("[firestore] fallo al usar contacto_confianza", { ubicacion, tipo });
}

/** Nombre del tipo del fallo; nunca su mensaje ni datos del documento. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Convierte lo leído de Firestore al contrato del cable, validándolo con Zod. */
function aContacto(id: string, crudo: object): Contacto {
  return ContactoSchema.parse({ ...ContactoDocumentoSchema.parse(crudo), id });
}

/** Documento a escribir: el contrato sin el `id`, que es la llave. */
function aDocumento(contacto: Contacto): object {
  return ContactoDocumentoSchema.parse({
    nombre: contacto.nombre,
    telefono: contacto.telefono,
    parentesco: contacto.parentesco,
    created_at: contacto.created_at,
    updated_at: contacto.updated_at,
    deleted_at: contacto.deleted_at,
  });
}

/** Contacto previo del `id`, o `null` si el documento aún no existe. */
function previoDe(instantanea: SnapshotDeDocumento, id: string): Contacto | null {
  if (!instantanea.exists) {
    return null;
  }
  return aContacto(id, instantanea.data() ?? {});
}

/** `true` si el documento está activo (no borrado lógicamente). */
function estaActivo(contacto: Contacto): boolean {
  return contacto.deleted_at === null;
}

/** `created_at` se conserva si el documento existía; si no, es `ahora` (R8). */
function creadoEn(previo: Contacto | null, ahora: string): string {
  if (previo === null) {
    return ahora;
  }
  return previo.created_at;
}

/**
 * Cuerpo de la transacción de `guardar`: lee el previo y los activos, aplica
 * R4/R5/R6/R7 y escribe. Todas las lecturas van antes de la escritura.
 */
async function escribirContacto(
  transaccion: Transaction,
  coleccion: ReturnType<typeof getColeccion>,
  datos: DatosGuardado,
): Promise<Contacto> {
  const documento = coleccion.doc(datos.id);
  const previo = previoDe(await transaccion.get(documento), datos.id);
  const consultaActivos = coleccion.where("deleted_at", "==", null).limit(MAXIMO_ACTIVOS);
  const instantaneaActivos = await transaccion.get(consultaActivos);
  const activos = instantaneaActivos.docs.map((doc) => aContacto(doc.id, doc.data()));
  const eraActivo = previo !== null && estaActivo(previo);
  // R4 se aplica a los activos que quedan tras la escritura, no al estado previo:
  // restaurar un contacto borrado puede añadir el 6.º si alguien ocupó su hueco.
  const otrosActivos = activos.filter((otro) => otro.id !== datos.id).length;
  if (!eraActivo && otrosActivos >= MAXIMO_ACTIVOS) {
    throw new ConflictoDeContactos("limite");
  }
  if (activos.some((otro) => otro.id !== datos.id && otro.telefono === datos.telefono)) {
    throw new ConflictoDeContactos("telefono");
  }
  const escrito: Contacto = {
    id: datos.id,
    nombre: datos.nombre,
    telefono: datos.telefono,
    parentesco: datos.parentesco,
    created_at: creadoEn(previo, datos.ahora),
    updated_at: datos.ahora,
    deleted_at: null,
  };
  transaccion.set(documento, aDocumento(escrito));
  return escrito;
}

/** Referencia a la colección de contactos de una cuenta. */
function getColeccion(firestore: ReturnType<typeof getFirestore>, uid: string) {
  return firestore.collection("usuarios").doc(uid).collection(COLECCION_CONTACTOS);
}

/** Query de sincronización: `updated_at > since`, ascendente, acotada (R10). */
function consultaDesde(
  coleccion: ReturnType<typeof getColeccion>,
  peticion: ListarContactos,
): ReturnType<typeof coleccion.where> {
  if (peticion.since === null) {
    return coleccion.orderBy("updated_at", "asc").limit(peticion.limite);
  }
  return coleccion
    .where("updated_at", ">", peticion.since)
    .orderBy("updated_at", "asc")
    .limit(peticion.limite);
}

/** Repositorio real: reserva la app de Admin solo cuando se usa. */
export function crearRepositorioContactosFirestore(): RepositorioContactos {
  /** Lista los contactos con `updated_at > since`, ascendente y acotada. */
  async function listar(peticion: ListarContactos): Promise<Contacto[]> {
    try {
      const app = await obtenerApp();
      const coleccion = getColeccion(getFirestore(app), peticion.uid);
      const instantanea = await consultaDesde(coleccion, peticion).get();
      return instantanea.docs.map((doc) => aContacto(doc.id, doc.data()));
    } catch (capturado) {
      registrarFallo("listar", capturado!);
      throw capturado!;
    }
  }

  /** Lee un contacto de la cuenta; `null` si no existe. */
  async function obtener(uid: string, id: string): Promise<Contacto | null> {
    try {
      const app = await obtenerApp();
      const instantanea = await getColeccion(getFirestore(app), uid).doc(id).get();
      return previoDe(instantanea, id);
    } catch (capturado) {
      registrarFallo("obtener", capturado!);
      throw capturado!;
    }
  }

  /** Crea o reemplaza dentro de una transacción: lecturas antes de escribir. */
  async function guardar(uid: string, datos: DatosGuardado): Promise<Contacto> {
    try {
      const app = await obtenerApp();
      const firestore = getFirestore(app);
      const coleccion = getColeccion(firestore, uid);
      return await firestore.runTransaction((transaccion) =>
        escribirContacto(transaccion, coleccion, datos),
      );
    } catch (capturado) {
      if (capturado instanceof ConflictoDeContactos) {
        throw capturado;
      }
      registrarFallo("guardar", capturado!);
      throw capturado!;
    }
  }

  /** Borrado lógico en una transacción; `null` si no existía o ya estaba borrado. */
  async function borrarLogicamente(
    uid: string,
    id: string,
    ahora: string,
  ): Promise<Contacto | null> {
    try {
      const app = await obtenerApp();
      const firestore = getFirestore(app);
      const documento = getColeccion(firestore, uid).doc(id);
      return await firestore.runTransaction(async (transaccion) => {
        const previo = previoDe(await transaccion.get(documento), id);
        if (previo === null) {
          return null;
        }
        if (previo.deleted_at !== null) {
          return null;
        }
        const borrado: Contacto = { ...previo, deleted_at: ahora, updated_at: ahora };
        transaccion.set(documento, aDocumento(borrado));
        return borrado;
      });
    } catch (capturado) {
      registrarFallo("borrarLogicamente", capturado!);
      throw capturado!;
    }
  }

  return { listar, obtener, guardar, borrarLogicamente };
}
