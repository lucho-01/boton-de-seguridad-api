import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { obtenerApp } from "@/shared/server/firebase";
import type { EstadoIntentos } from "./intentos";
import type { RepositorioIntentos } from "./intentos-repository";

/**
 * Repositorio de contadores en Firestore (spec A6, §7; ADR-0012).
 *
 * Colección raíz `intentos_login`, un documento por clave (hash del par o de
 * la IP). `ejecutar` corre en una transacción: leer → calcular → escribir o
 * borrar, con todas las lecturas antes de la escritura. `expira_en` se guarda
 * como `Timestamp` para que la política TTL de Firestore pueda borrarlo (R9).
 * Cada documento leído se valida con Zod. Los logs solo dicen tipo y ubicación:
 * nunca correo, IP, hash ni contraseña.
 */

/** Colección raíz de los contadores (spec A6, §7). */
export const COLECCION_INTENTOS = "intentos_login";

/** Forma del documento tal como vive en Firestore (`expira_en` es TTL). */
const EstadoIntentosDocumentoSchema = z.object({
  fallos: z.int().min(1),
  ventana_inicio: z.string(),
  bloqueado_hasta: z.string().nullable(),
  expira_en: z.instanceof(Timestamp),
});

/** Forma del estado ya convertido al contrato ISO 8601 UTC. */
const EstadoIntentosSchema = z.object({
  fallos: z.int().min(1),
  ventana_inicio: z.string(),
  bloqueado_hasta: z.string().nullable(),
  expira_en: z.string(),
});

/** Log de un fallo de Firestore: tipo y ubicación, nunca datos del contador. */
function registrarFallo(ubicacion: string, fallo: object): void {
  const tipo = describirTipo(fallo);
  console.error("[firestore] fallo al usar intentos_login", { ubicacion, tipo });
}

/** Nombre del tipo del fallo; nunca su mensaje ni datos personales. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Convierte lo leído de Firestore al contrato, validándolo con Zod primero. */
function aEstado(crudo: object): EstadoIntentos {
  const documento = EstadoIntentosDocumentoSchema.parse(crudo);
  return EstadoIntentosSchema.parse({
    fallos: documento.fallos,
    ventana_inicio: documento.ventana_inicio,
    bloqueado_hasta: documento.bloqueado_hasta,
    expira_en: documento.expira_en.toDate().toISOString(),
  });
}

/**
 * Como `aEstado`, pero un documento con forma inválida (edición manual,
 * escritura parcial) se trata como ausente y se registra solo su tipo. Si
 * lanzara, el fail-closed convertiría ese documento en un 500 permanente para
 * esa clave: un bloqueo de login dirigido.
 */
function aEstadoSeguro(crudo: object, ubicacion: string): EstadoIntentos | null {
  try {
    return aEstado(crudo);
  } catch (capturado) {
    console.error("[firestore] documento de intentos_login con forma inválida", {
      ubicacion,
      tipo: describirTipo(capturado!),
    });
    return null;
  }
}

/** Documento a escribir: `expira_en` como `Timestamp` para el TTL de Firestore. */
function aDocumento(estado: EstadoIntentos): object {
  return {
    fallos: estado.fallos,
    ventana_inicio: estado.ventana_inicio,
    bloqueado_hasta: estado.bloqueado_hasta,
    expira_en: Timestamp.fromMillis(Date.parse(estado.expira_en)),
  };
}

/** Colección raíz de contadores (sin índices: solo se accede por documento). */
function getColeccion(firestore: ReturnType<typeof getFirestore>) {
  return firestore.collection(COLECCION_INTENTOS);
}

/** Implementación real del puerto `RepositorioIntentos`. */
export function crearRepositorioIntentosFirestore(): RepositorioIntentos {
  /** Estado guardado para una clave; `null` si el documento no existe. */
  async function leer(clave: string): Promise<EstadoIntentos | null> {
    try {
      const app = await obtenerApp();
      const instantanea = await getColeccion(getFirestore(app)).doc(clave).get();
      if (!instantanea.exists) {
        return null;
      }
      return aEstadoSeguro(instantanea.data() ?? {}, "leer");
    } catch (capturado) {
      registrarFallo("leer", capturado!);
      throw capturado!;
    }
  }

  /** Lee, calcula y guarda (o borra) en una transacción. */
  async function ejecutar(
    clave: string,
    operacion: (actual: EstadoIntentos | null) => EstadoIntentos | null,
  ): Promise<EstadoIntentos | null> {
    try {
      const app = await obtenerApp();
      const firestore = getFirestore(app);
      const documento = getColeccion(firestore).doc(clave);
      return await firestore.runTransaction(async (transaccion) => {
        const instantanea = await transaccion.get(documento);
        let actual: EstadoIntentos | null = null;
        if (instantanea.exists) {
          actual = aEstadoSeguro(instantanea.data() ?? {}, "ejecutar");
        }
        const siguiente = operacion(actual);
        if (siguiente === null) {
          transaccion.delete(documento);
          return null;
        }
        transaccion.set(documento, aDocumento(siguiente));
        return siguiente;
      });
    } catch (capturado) {
      registrarFallo("ejecutar", capturado!);
      throw capturado!;
    }
  }

  return { leer, ejecutar };
}
