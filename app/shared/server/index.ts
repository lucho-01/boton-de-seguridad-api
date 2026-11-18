/**
 * Fachada de la infraestructura compartida (`app/shared/server/*`).
 *
 * Las rutas importan de aquí en pocas líneas y no dependen de cómo se reparte
 * cada pieza entre archivos. Los servidores de una feature importan el archivo
 * concreto que necesitan (errores, sesión, reloj), nunca esta fachada.
 */
export {
  Conflicto,
  DemasiadoGrande,
  DemasiadosIntentos,
  ErrorDeConfiguracion,
  ErrorDeDominio,
  ErrorInterno,
  ErrorDeValidacion,
  NoAutenticado,
  NoAutorizado,
  NoEncontrado,
  NoSoportado,
} from "@/shared/server/errors";
export { evaluarEntornoActual, obtenerEntorno } from "@/shared/server/env";
export type { Entorno, EvaluacionEntorno } from "@/shared/server/env";
export { obtenerApp, verificarIdToken } from "@/shared/server/firebase";
export {
  exigirJson,
  leerBearer,
  leerCuerpo,
  leerJson,
  manejar,
  manejarConContexto,
  parseoZod,
  responderJson,
  respuestaDeError,
} from "@/shared/server/http";
export { requiereSesion } from "@/shared/server/session";
export type { VerificadorDeToken } from "@/shared/server/session";
export { aIso, relojDelSistema } from "@/shared/server/time";
export type { Reloj } from "@/shared/server/time";
