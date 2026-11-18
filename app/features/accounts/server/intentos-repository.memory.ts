import type { EstadoIntentos } from "./intentos";
import type { RepositorioIntentos } from "./intentos-repository";

/**
 * Repositorio de contadores en memoria (spec A6, §9).
 *
 * Cada instancia tiene su propio mapa, así que dos pruebas nunca comparten
 * estado. Todo lo que entra y sale es una copia: mutar lo devuelto no altera
 * el repositorio. No hay reglas de negocio aquí.
 */

/** Copia defensiva del estado; `null` se conserva. */
function copiar(estado: EstadoIntentos | null): EstadoIntentos | null {
  if (estado === null) {
    return null;
  }
  return { ...estado };
}

/** Crea el doble en memoria del puerto `RepositorioIntentos`. */
export function crearRepositorioIntentosEnMemoria(): RepositorioIntentos {
  const documentos = new Map<string, EstadoIntentos>();

  return {
    async leer(clave: string): Promise<EstadoIntentos | null> {
      return copiar(documentos.get(clave) ?? null);
    },

    async ejecutar(
      clave: string,
      operacion: (actual: EstadoIntentos | null) => EstadoIntentos | null,
    ): Promise<EstadoIntentos | null> {
      const actual = copiar(documentos.get(clave) ?? null);
      const siguiente = operacion(actual);
      if (siguiente === null) {
        documentos.delete(clave);
        return null;
      }
      documentos.set(clave, { ...siguiente });
      return copiar(siguiente);
    },
  };
}
