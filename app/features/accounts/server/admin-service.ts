import { type EstadoAdmin, EstadoAdminSchema, type Sesion } from "@/shared/schema";
import { ErrorInterno, NoAutorizado } from "@/shared/server/errors";
import type { RepositorioAdmin } from "./admin-repository";

/**
 * Reglas de negocio del diagnóstico (spec A5, §4, §6; ADR-0011).
 *
 * R1: solo responde a una sesión con `rol = "admin"`. R2: el rol sale siempre
 * de la sesión derivada del token verificado, nunca del cuerpo, la query ni la
 * URL, así que este servicio ni siquiera recibe otra entrada.
 *
 * La comprobación de rol va **antes** de tocar el repositorio (criterio 2): un
 * `usuario` autenticado recibe `403` sin ninguna consulta a Firestore. Un fallo
 * del repositorio, o un resultado que no encaje con el contrato, se registra
 * solo por tipo y ubicación y se traduce a `500` opaco (R6, R7).
 */

/** Cara del servicio que usan las rutas. */
export type ServicioAdmin = {
  /** Devuelve los totales agregados o lanza `NoAutorizado`/`ErrorInterno`. */
  estado(sesion: Sesion): Promise<EstadoAdmin>;
};

/** Dependencias del servicio, todas inyectadas. */
export type DependenciasAdmin = {
  repositorio: RepositorioAdmin;
};

/** Rol que exige la ruta (R1); no hay autoascenso en la API (R4). */
const ROL_ADMIN = "admin";

/** Log de un fallo al contar: tipo y ubicación, nunca datos personales (R7). */
function registrarFallo(fallo: object): void {
  console.error("[admin] fallo al contar el estado", {
    tipo: describirTipo(fallo),
    ubicacion: describirUbicacion(fallo),
  });
}

/** Nombre del tipo del fallo; nunca su mensaje. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Primera línea de la pila que no sea el propio mensaje; nunca datos. */
function describirUbicacion(fallo: object): string {
  if (!(fallo instanceof Error)) {
    return "sin pila";
  }
  if (fallo.stack === undefined) {
    return "sin pila";
  }
  const lineas = fallo.stack.split("\n");
  if (lineas[1] === undefined) {
    return "sin pila";
  }
  return lineas[1].trim();
}

/** Crea el servicio de diagnóstico con sus dependencias inyectadas. */
export function crearServicioAdmin(dependencias: DependenciasAdmin): ServicioAdmin {
  return {
    async estado(sesion: Sesion): Promise<EstadoAdmin> {
      if (sesion.rol !== ROL_ADMIN) {
        throw new NoAutorizado();
      }
      try {
        const totales = await dependencias.repositorio.contar();
        return EstadoAdminSchema.parse(totales);
      } catch (capturado) {
        registrarFallo(capturado!);
        throw new ErrorInterno();
      }
    },
  };
}
