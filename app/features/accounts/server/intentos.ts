import { aIso, aIsoDesplazado } from "@/shared/server/time";

/**
 * Contador de intentos de login como función pura (spec A6, §7; ADR-0012).
 *
 * El repositorio solo persiste; decidir si un fallo suma, bloquea o reinicia
 * ocurre aquí, con el instante recibido. Nada de `new Date()`: el tiempo entra
 * por parámetro y el formato del cable es ISO 8601 UTC.
 */

/** Estado de un contador tal como se guarda y se lee (spec A6, §7). */
export type EstadoIntentos = {
  /** Fallos dentro de la ventana actual (entero >= 1). */
  fallos: number;
  /** Inicio de la ventana, ISO 8601 UTC. */
  ventana_inicio: string;
  /** Fin del bloqueo, ISO 8601 UTC, o `null` si no está bloqueado. */
  bloqueado_hasta: string | null;
  /** Momento en que el documento puede borrarse por TTL, ISO 8601 UTC. */
  expira_en: string;
};

/** Fallos por par `correo + IP` que disparan el bloqueo (R2). */
export const UMBRAL_PAR = 5;

/** Fallos por IP sola que disparan el bloqueo (R2, decisión anti-spray). */
export const UMBRAL_IP = 20;

/** Ventana de conteo: 15 minutos (R2). */
export const VENTANA_MS = 15 * 60 * 1000;

/** Duración del bloqueo: 15 minutos desde el último fallo (R2). */
export const BLOQUEO_MS = 15 * 60 * 1000;

/** Vida mínima del documento antes del TTL (R9). */
const TTL_MS = 24 * 60 * 60 * 1000;

/** Mensaje literal del 429 (spec A1/A6), compartido con la traducción de Firebase. */
export const MENSAJE_LIMITE = "Demasiados intentos; espera unos minutos";

/**
 * `true` si el fallo anterior cae dentro de la ventana que empieza en
 * `ventana_inicio`; fuera de ella el contador arranca de cero (R2, R9).
 */
function sigueEnVentana(actual: EstadoIntentos | null, ahora: Date): boolean {
  if (actual === null) {
    return false;
  }
  return ahora.getTime() - Date.parse(actual.ventana_inicio) <= VENTANA_MS;
}

/** Fallos acumulados antes de este intento: los de la ventana o cero. */
function fallosPrevios(actual: EstadoIntentos | null, ahora: Date): number {
  if (!sigueEnVentana(actual, ahora)) {
    return 0;
  }
  if (actual === null) {
    return 0;
  }
  return actual.fallos;
}

/** Inicio de la ventana: se conserva si el fallo anterior cae dentro de ella. */
function inicioDeVentana(actual: EstadoIntentos | null, ahora: Date): string {
  if (!sigueEnVentana(actual, ahora)) {
    return aIso(ahora);
  }
  if (actual === null) {
    return aIso(ahora);
  }
  return actual.ventana_inicio;
}

/** Fin del bloqueo si se alcanzó el umbral; `null` mientras no se alcance. */
function bloqueoTras(fallos: number, umbral: number, ahora: Date): string | null {
  if (fallos < umbral) {
    return null;
  }
  return aIsoDesplazado(ahora, BLOQUEO_MS);
}

/**
 * TTL del documento: al menos 24 h y nunca antes de 24 h tras el fin del
 * bloqueo (R9). Si el TTL no está activo, el estado viejo se reinicia al
 * leerlo porque la ventana ya habrá expirado.
 */
function expiracionDe(ahora: Date, bloqueadoHasta: string | null): string {
  if (bloqueadoHasta === null) {
    return aIsoDesplazado(ahora, TTL_MS);
  }
  const finBloqueo = Date.parse(bloqueadoHasta);
  const desdeAhora = Math.max(0, finBloqueo - ahora.getTime());
  return aIsoDesplazado(ahora, desdeAhora + TTL_MS);
}

/**
 * Estado nuevo tras un fallo de credenciales (R1, R2, R5): reinicia la ventana
 * si estaba vacía o vieja, suma uno y bloquea al alcanzar `umbral`.
 */
export function estadoTrasFallo(
  actual: EstadoIntentos | null,
  ahora: Date,
  umbral: number,
): EstadoIntentos {
  const fallos = fallosPrevios(actual, ahora) + 1;
  const bloqueadoHasta = bloqueoTras(fallos, umbral, ahora);
  return {
    fallos,
    ventana_inicio: inicioDeVentana(actual, ahora),
    bloqueado_hasta: bloqueadoHasta,
    expira_en: expiracionDe(ahora, bloqueadoHasta),
  };
}

/** `true` si el contador está bloqueado en este instante (R3). */
export function estaBloqueado(actual: EstadoIntentos | null, ahora: Date): boolean {
  if (actual === null) {
    return false;
  }
  if (actual.bloqueado_hasta === null) {
    return false;
  }
  return Date.parse(actual.bloqueado_hasta) > ahora.getTime();
}
