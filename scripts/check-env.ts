import { fileURLToPath } from "node:url";
import {
  type EstadoVariable,
  evaluarEntorno,
  type EvaluacionEntorno,
  VARIABLES_ENTORNO,
  VARIABLE_OPCIONAL,
  VARIABLES_OBLIGATORIAS,
} from "@/shared/server/env";

/**
 * `npm run check:env` (spec A0, R8; criterio 11).
 *
 * Imprime una tabla `VARIABLE — estado` (`presente` / `falta` / `vacía`), una
 * nota final y sale con código `1` si falta alguna obligatoria. Jamás imprime
 * valores: el único dato de cada fila es el estado.
 */

/** Ancho de la primera columna: la variable más larga más dos espacios. */
const ANCHO_VARIABLE = VARIABLES_ENTORNO.reduce((maximo, nombre) => {
  return Math.max(maximo, nombre.length);
}, 0);

/** Texto justificado a la izquierda. */
function columna(texto: string, ancho: number): string {
  return texto.padEnd(ancho, " ");
}

/** Tabla completa, sin un solo valor del entorno. */
export function formatearTabla(evaluacion: EvaluacionEntorno): string[] {
  const filas = ["VARIABLE".padEnd(ANCHO_VARIABLE + 2, " ") + "ESTADO"];
  for (const nombre of VARIABLES_ENTORNO) {
    const estado: EstadoVariable = evaluacion.variables[nombre];
    filas.push(columna(nombre, ANCHO_VARIABLE + 2) + estado);
  }
  return filas;
}

/** Texto de la nota para `CORS_ORIGINS` según su estado (nunca su valor). */
const NOTAS_CORS: Record<EstadoVariable, string> = {
  presente: "CORS_ORIGINS: definida (opcional).",
  vacía: "CORS_ORIGINS: vacía (opcional, sin orígenes permitidos).",
  falta: "CORS_ORIGINS: no definida (opcional, sin orígenes permitidos).",
};

/** Nota final: qué falta por variable obligatoria, o el OK de despliegue. */
export function formatearNota(evaluacion: EvaluacionEntorno): string {
  const faltantes = evaluacion.faltantes.join(", ");
  const notaCors = NOTAS_CORS[evaluacion.variables[VARIABLE_OPCIONAL]];
  if (evaluacion.estaCompleto) {
    return `Entorno completo: las ${VARIABLES_OBLIGATORIAS.length} obligatorias tienen valor. ${notaCors}`;
  }
  return `Faltan obligatorias: ${faltantes}. Cópialas en .env a partir de .env.example (nunca las subas). ${notaCors}`;
}

/** Ejecuta el CLI y devuelve el código de salida sin llamar a `process.exit`. */
export function ejecutarVerificacion(entrada: Record<string, string | undefined>): {
  lineas: string[];
  codigoSalida: number;
} {
  const evaluacion = evaluarEntorno(entrada);
  const lineas = [...formatearTabla(evaluacion), "", formatearNota(evaluacion)];
  if (evaluacion.estaCompleto) {
    return { lineas, codigoSalida: 0 };
  }
  return { lineas, codigoSalida: 1 };
}

/** ¿Se está ejecutando este archivo directamente (`npm run check:env`)? */
export function esEjecucionDirecta(metaUrl: string, argv: readonly string[]): boolean {
  const propio = argv[1];
  if (propio === undefined) {
    return false;
  }
  return fileURLToPath(metaUrl) === propio;
}

if (esEjecucionDirecta(import.meta.url, process.argv)) {
  const { lineas, codigoSalida } = ejecutarVerificacion(process.env);
  for (const linea of lineas) {
    console.log(linea);
  }
  process.exit(codigoSalida);
}
