import type { Alerta } from "@/shared/schema";
import type { DatosGuardadoAlerta, ListarAlertas, RepositorioAlertas } from "./repository";

/**
 * Repositorio de alertas en memoria (spec A3, §9; ADR-0003, ADR-0009).
 *
 * Replica el repositorio real sin Firestore: cada instancia es un mapa
 * `uid → (id → alerta)`, así que dos pruebas nunca comparten estado.
 * `guardar` conserva `created_at` y restaura un borrado; `listar` ordena por
 * `updated_at` ascendente y acota a `limite`; `listarNoBorradas` excluye los
 * borrados lógicos y ordena por `creada_en` descendente (para el resumen).
 */

/** Orden estable por `updated_at` y, a igualdad, por `id`. */
function compararPorUpdatedAt(a: Alerta, b: Alerta): number {
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

/**
 * Orden del resumen: `creada_en` descendente y, a igualdad, por `updated_at` y
 * `id` para que el resultado sea determinista.
 */
function compararPorCreadaEn(a: Alerta, b: Alerta): number {
  if (a.creada_en > b.creada_en) {
    return -1;
  }
  if (a.creada_en < b.creada_en) {
    return 1;
  }
  return compararPorUpdatedAt(a, b);
}

/** Documento completo a partir de los datos del servicio (R5). */
function documento(datos: DatosGuardadoAlerta, creadoEn: string): Alerta {
  return {
    id: datos.id,
    lat: datos.lat,
    lng: datos.lng,
    precision_m: datos.precision_m,
    bateria_pct: datos.bateria_pct,
    estado: datos.estado,
    creada_en: datos.creada_en,
    created_at: creadoEn,
    updated_at: datos.ahora,
    deleted_at: null,
  };
}

/** Constructor del doble: un mapa privado por instancia. */
export function crearRepositorioAlertasEnMemoria(): RepositorioAlertas {
  const cuentas = new Map<string, Map<string, Alerta>>();

  /** Mapa de la cuenta; se crea la primera vez que aparece su `uid`. */
  function alertasDe(uid: string): Map<string, Alerta> {
    const existente = cuentas.get(uid);
    if (existente !== undefined) {
      return existente;
    }
    const nuevo = new Map<string, Alerta>();
    cuentas.set(uid, nuevo);
    return nuevo;
  }

  return {
    async listar(peticion: ListarAlertas): Promise<Alerta[]> {
      const alertas = cuentas.get(peticion.uid) ?? new Map<string, Alerta>();
      const filtradas: Alerta[] = [];
      for (const alerta of alertas.values()) {
        if (peticion.since !== null && alerta.updated_at <= peticion.since) {
          continue;
        }
        filtradas.push({ ...alerta });
      }
      filtradas.sort(compararPorUpdatedAt);
      return filtradas.slice(0, peticion.limite);
    },

    async guardar(peticion: { uid: string; alerta: DatosGuardadoAlerta }): Promise<Alerta> {
      const alertas = alertasDe(peticion.uid);
      const previo = alertas.get(peticion.alerta.id);
      const creadoEn = previo?.created_at ?? peticion.alerta.ahora;
      const escrito = documento(peticion.alerta, creadoEn);
      alertas.set(escrito.id, escrito);
      return { ...escrito };
    },

    async borrarLogicamente(peticion: {
      uid: string;
      id: string;
      ahora: string;
    }): Promise<Alerta | null> {
      const alertas = cuentas.get(peticion.uid);
      if (alertas === undefined) {
        return null;
      }
      const previo = alertas.get(peticion.id);
      if (previo === undefined) {
        return null;
      }
      if (previo.deleted_at !== null) {
        return null;
      }
      const borrado: Alerta = { ...previo, deleted_at: peticion.ahora, updated_at: peticion.ahora };
      alertas.set(peticion.id, borrado);
      return { ...borrado };
    },

    async listarNoBorradas(peticion: { uid: string }): Promise<Alerta[]> {
      const alertas = cuentas.get(peticion.uid) ?? new Map<string, Alerta>();
      const activas: Alerta[] = [];
      for (const alerta of alertas.values()) {
        if (alerta.deleted_at !== null) {
          continue;
        }
        activas.push({ ...alerta });
      }
      activas.sort(compararPorCreadaEn);
      return activas;
    },
  };
}
