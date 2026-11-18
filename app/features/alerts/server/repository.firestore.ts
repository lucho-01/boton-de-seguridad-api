import { getFirestore } from "firebase-admin/firestore";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { type Alerta, AlertaSchema } from "@/shared/schema";
import { obtenerApp } from "@/shared/server/firebase";
import type { DatosGuardadoAlerta, ListarAlertas, RepositorioAlertas } from "./repository";

/**
 * Repositorio de alertas en Firestore (spec A3, §7; ADR-0003, ADR-0009).
 *
 * Ruta `usuarios/{uid}/alerta/{id}`. Cada documento leído se valida con
 * `AlertaSchema` antes de salir del repositorio. `guardar` corre en una
 * transacción (ADR-0003: lecturas antes de la escritura) para conservar
 * `created_at` aunque dos `PUT` del mismo id lleguen a la vez. `listarNoBorradas`
 * usa el índice `creada_en DESC` del resumen. Nunca se registran coordenadas,
 * batería, ids ni hora de la alerta: los logs solo dicen tipo y ubicación.
 */

/** Colección de alertas dentro de `usuarios/{uid}`. */
export const COLECCION_ALERTAS = "alerta";

/** Forma del documento en Firestore: el contrato sin el `id` (va en la ruta). */
const AlertaDocumentoSchema = AlertaSchema.omit({ id: true });

/** Snapshot mínimo que necesita `previoDe`: existencia y datos. */
type SnapshotDeDocumento = {
  exists: boolean;
  data(): object | undefined;
};

/** Log de un fallo de Firestore: tipo y ubicación, nunca datos del documento. */
function registrarFallo(ubicacion: string, fallo: object): void {
  console.error("[firestore] fallo al usar alerta", { ubicacion, tipo: describirTipo(fallo) });
}

/** Nombre del tipo del fallo; nunca su mensaje ni datos del documento. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Convierte lo leído de Firestore al contrato del cable, validándolo con Zod. */
function aAlerta(id: string, crudo: object): Alerta {
  return AlertaSchema.parse({ ...AlertaDocumentoSchema.parse(crudo), id });
}

/** Documento a escribir: el contrato sin el `id`, que es la llave. */
function aDocumento(alerta: Alerta): object {
  return AlertaDocumentoSchema.parse({
    lat: alerta.lat,
    lng: alerta.lng,
    precision_m: alerta.precision_m,
    bateria_pct: alerta.bateria_pct,
    estado: alerta.estado,
    creada_en: alerta.creada_en,
    created_at: alerta.created_at,
    updated_at: alerta.updated_at,
    deleted_at: alerta.deleted_at,
  });
}

/** Alerta previa del `id`, o `null` si el documento aún no existe. */
function previoDe(instantanea: SnapshotDeDocumento, id: string): Alerta | null {
  if (!instantanea.exists) {
    return null;
  }
  return aAlerta(id, instantanea.data() ?? {});
}

/** `created_at` se conserva si el documento existía; si no, es `ahora` (R5). */
function creadoEn(previo: Alerta | null, ahora: string): string {
  if (previo === null) {
    return ahora;
  }
  return previo.created_at;
}

/** Documento a partir de los datos del servicio y el `created_at` resuelto. */
function alertaEscrita(datos: DatosGuardadoAlerta, creado: string): Alerta {
  return {
    id: datos.id,
    lat: datos.lat,
    lng: datos.lng,
    precision_m: datos.precision_m,
    bateria_pct: datos.bateria_pct,
    estado: datos.estado,
    creada_en: datos.creada_en,
    created_at: creado,
    updated_at: datos.ahora,
    deleted_at: null,
  };
}

/** Referencias de Firestore ya resueltas para una operación. */
type Entorno = {
  firestore: Firestore;
  coleccion: ReturnType<typeof getColeccion>;
};

/** Cuerpo de la transacción de `guardar`: lee el previo y escribe (R5). */
async function escribirAlerta(
  transaccion: Transaction,
  entorno: Entorno,
  datos: DatosGuardadoAlerta,
): Promise<Alerta> {
  const documento = entorno.coleccion.doc(datos.id);
  const previo = previoDe(await transaccion.get(documento), datos.id);
  const escrito = alertaEscrita(datos, creadoEn(previo, datos.ahora));
  transaccion.set(documento, aDocumento(escrito));
  return escrito;
}

/** Cuerpo de la transacción de `borrarLogicamente`: 404 si no existe o ya se borró. */
async function borrarEnTransaccion(
  transaccion: Transaction,
  entorno: Entorno,
  peticion: { id: string; ahora: string },
): Promise<Alerta | null> {
  const documento = entorno.coleccion.doc(peticion.id);
  const previo = previoDe(await transaccion.get(documento), peticion.id);
  if (previo === null) {
    return null;
  }
  if (previo.deleted_at !== null) {
    return null;
  }
  const borrado: Alerta = { ...previo, deleted_at: peticion.ahora, updated_at: peticion.ahora };
  transaccion.set(documento, aDocumento(borrado));
  return borrado;
}

/** Referencia a la colección de alertas de una cuenta. */
function getColeccion(firestore: Firestore, uid: string) {
  return firestore.collection("usuarios").doc(uid).collection(COLECCION_ALERTAS);
}

/** Query de sincronización: `updated_at > since`, ascendente, acotada (R7). */
function consultaDesde(
  coleccion: ReturnType<typeof getColeccion>,
  peticion: ListarAlertas,
): ReturnType<typeof coleccion.where> {
  if (peticion.since === null) {
    return coleccion.orderBy("updated_at", "asc").limit(peticion.limite);
  }
  return coleccion
    .where("updated_at", ">", peticion.since)
    .orderBy("updated_at", "asc")
    .limit(peticion.limite);
}

/** Documentos por lectura del resumen (cada lectura es una consulta paginada). */
const TAMANO_LOTE = 500;

/** Página del resumen: no borradas, `creada_en` descendente, tras el cursor (R8). */
function consultaNoBorradas(
  coleccion: ReturnType<typeof getColeccion>,
  cursor: Alerta | null,
): ReturnType<typeof coleccion.where> {
  const base = coleccion.where("deleted_at", "==", null);
  if (cursor === null) {
    return base.orderBy("creada_en", "desc").limit(TAMANO_LOTE);
  }
  return base.orderBy("creada_en", "desc").startAfter(cursor.creada_en).limit(TAMANO_LOTE);
}

/** Repositorio real: reserva la app de Admin solo cuando se usa. */
export function crearRepositorioAlertasFirestore(): RepositorioAlertas {
  /** Resuelve Firestore y la colección de la cuenta para una operación. */
  async function abrir(uid: string): Promise<Entorno> {
    const app = await obtenerApp();
    const firestore = getFirestore(app);
    return { firestore, coleccion: getColeccion(firestore, uid) };
  }

  /** Lista las alertas con `updated_at > since`, ascendente y acotada. */
  async function listar(peticion: ListarAlertas): Promise<Alerta[]> {
    try {
      const entorno = await abrir(peticion.uid);
      const instantanea = await consultaDesde(entorno.coleccion, peticion).get();
      return instantanea.docs.map((doc) => aAlerta(doc.id, doc.data()));
    } catch (capturado) {
      registrarFallo("listar", capturado!);
      throw capturado!;
    }
  }

  /** Crea o reemplaza dentro de una transacción; conserva `created_at`. */
  async function guardar(peticion: { uid: string; alerta: DatosGuardadoAlerta }): Promise<Alerta> {
    try {
      const entorno = await abrir(peticion.uid);
      return await entorno.firestore.runTransaction((transaccion) =>
        escribirAlerta(transaccion, entorno, peticion.alerta),
      );
    } catch (capturado) {
      registrarFallo("guardar", capturado!);
      throw capturado!;
    }
  }

  /** Borrado lógico en una transacción; `null` si no existía o ya estaba borrado. */
  async function borrarLogicamente(peticion: {
    uid: string;
    id: string;
    ahora: string;
  }): Promise<Alerta | null> {
    try {
      const entorno = await abrir(peticion.uid);
      return await entorno.firestore.runTransaction((transaccion) =>
        borrarEnTransaccion(transaccion, entorno, peticion),
      );
    } catch (capturado) {
      registrarFallo("borrarLogicamente", capturado!);
      throw capturado!;
    }
  }

  /**
   * Alertas no borradas por `creada_en` descendente (índice declarado). Pagina
   * de a lotes para no cargar la cuenta entera en memoria en una sola lectura.
   */
  async function listarNoBorradas(peticion: { uid: string }): Promise<Alerta[]> {
    try {
      const entorno = await abrir(peticion.uid);
      const alertas: Alerta[] = [];
      let ultimo: Alerta | null = null;
      for (;;) {
        const instantanea = await consultaNoBorradas(entorno.coleccion, ultimo).get();
        for (const doc of instantanea.docs) {
          alertas.push(aAlerta(doc.id, doc.data()));
        }
        if (instantanea.docs.length < TAMANO_LOTE) {
          return alertas;
        }
        const final = instantanea.docs[instantanea.docs.length - 1];
        if (final === undefined) {
          return alertas;
        }
        ultimo = aAlerta(final.id, final.data());
      }
    } catch (capturado) {
      registrarFallo("listarNoBorradas", capturado!);
      throw capturado!;
    }
  }

  return { listar, guardar, borrarLogicamente, listarNoBorradas };
}
