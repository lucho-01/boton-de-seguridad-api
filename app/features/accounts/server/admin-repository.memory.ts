import type { EstadoAdmin } from "@/shared/schema";
import type { RepositorioAdmin } from "./admin-repository";

/**
 * Repositorio de diagnóstico en memoria (spec A5, §9).
 *
 * Cada llamada devuelve una copia nueva de los totales, de modo que mutar la
 * respuesta no altera el repositorio ni se comparte estado global entre
 * pruebas. `contar` relee el objeto `inicial` en cada llamada: una prueba puede
 * ajustar sus campos y el siguiente conteo los refleja sin recrear el
 * repositorio.
 */
export function crearRepositorioAdminEnMemoria(inicial: EstadoAdmin): RepositorioAdmin {
  return {
    async contar(): Promise<EstadoAdmin> {
      return {
        cuentas: inicial.cuentas,
        contactos: inicial.contactos,
        alertas: inicial.alertas,
      };
    },
  };
}
