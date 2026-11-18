/**
 * Tiempo inyectable (R9). Los servicios reciben `now: Date`; el único lugar
 * que mira el reloj del sistema es `relojDelSistema`, que vive en `shared/` y
 * se conecta en `app/features/container.ts`.
 */

/** Puerto del reloj: lo único que la lógica de negocio necesita del tiempo. */
export type Reloj = {
  ahora(): Date;
};

/** Implementación real. Es el único sitio de la API que llama a `new Date()`. */
export const relojDelSistema: Reloj = {
  ahora(): Date {
    return new Date();
  },
};

/** Fecha en ISO 8601 UTC (`2026-11-14T08:00:00.000Z`), el formato del contrato. */
export function aIso(fecha: Date): string {
  return fecha.toISOString();
}

/**
 * ISO 8601 UTC de `fecha` desplazada `milisegundos` (negativo resta). Evita
 * crear fechas sueltas dentro de las features: el reloj sigue siendo el único
 * origen del tiempo (spec A6, R2 y R9).
 */
export function aIsoDesplazado(fecha: Date, milisegundos: number): string {
  return new Date(fecha.getTime() + milisegundos).toISOString();
}
