import type { EstadoIntentos } from "./intentos";

/**
 * Puerto de persistencia de los contadores de intentos de login (spec A6, §7;
 * ADR-0012).
 *
 * El repositorio solo guarda y lee: no decide si un fallo suma, bloquea o
 * reinicia (eso es `estadoTrasFallo`, puro). La clave es un hash ya calculado
 * por el servicio: nunca se guarda correo, IP ni contraseña en claro (R6).
 */

/** Puerto del repositorio de contadores. */
export type RepositorioIntentos = {
  /** Estado guardado para `clave`, o `null` si no existe. */
  leer(clave: string): Promise<EstadoIntentos | null>;
  /**
   * Aplica `operacion` sobre el estado actual de `clave` y guarda el resultado.
   * Devolver `null` borra el documento. Debe ser atómico (transacción en
   * Firestore) para no perder fallos concurrentes.
   */
  ejecutar(
    clave: string,
    operacion: (actual: EstadoIntentos | null) => EstadoIntentos | null,
  ): Promise<EstadoIntentos | null>;
};
