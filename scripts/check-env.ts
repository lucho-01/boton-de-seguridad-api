import { fileURLToPath } from "node:url";
import {
  camposInvalidos,
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

/** Resultado de validar la forma de las variables, sin exponer valores. */
export type ResultadoFormato = {
  valido: boolean;
  /** Campos con forma inválida; vacío si falta alguna obligatoria. */
  campos: string[];
};

/** Comprueba el formato de las obligatorias; nunca devuelve ni imprime valores. */
export function validarFormato(entrada: Record<string, string | undefined>): ResultadoFormato {
  const evaluacion = evaluarEntorno(entrada);
  if (!evaluacion.estaCompleto) {
    return { valido: false, campos: [] };
  }
  const campos = camposInvalidos(entrada);
  if (campos.length > 0) {
    return { valido: false, campos };
  }
  return { valido: true, campos: [] };
}

/**
 * Señales estructurales de la clave privada, sin revelar su contenido. Sirve
 * para que un fallo de formato sea accionable sin imprimir el secreto.
 */
export function pistaClavePrivada(valor: string | undefined): string[] {
  if (valor === undefined) {
    return [];
  }
  const pistas: string[] = [];
  const real = valor.split("\\n").join("\n");
  const tieneInicio =
    real.includes("-----BEGIN PRIVATE KEY-----") ||
    real.includes("-----BEGIN RSA PRIVATE KEY-----");
  const tieneFin =
    real.includes("-----END PRIVATE KEY-----") || real.includes("-----END RSA PRIVATE KEY-----");
  if (!tieneInicio) {
    pistas.push("no contiene la cabecera -----BEGIN PRIVATE KEY-----");
  }
  if (!tieneFin) {
    pistas.push("no contiene el pie -----END PRIVATE KEY----- (¿pegaste solo la primera línea?)");
  }
  const cabeceraCompleta =
    valor.includes("-----BEGIN PRIVATE KEY-----") ||
    valor.includes("-----BEGIN RSA PRIVATE KEY-----");
  if (valor.startsWith("-----BEGIN") && !cabeceraCompleta) {
    pistas.push("parece cortada en el primer espacio: enciérrala entre comillas dobles");
  }
  if (!real.includes("\n")) {
    pistas.push("no tiene saltos de línea: escríbelos como \\n dentro de comillas dobles");
  }
  if (valor.length < 200) {
    pistas.push("es demasiado corta para una clave PEM (¿está cortada?)");
  }
  if (valor.trim().length < 40) {
    pistas.push("el valor es muy corto: parece un marcador o una ruta, no la clave");
  }
  if (valor.trim().toLowerCase().endsWith(".json")) {
    pistas.push("parece una ruta a un archivo: pega el contenido de private_key");
  }
  if (valor.includes("private_key")) {
    pistas.push("parece el JSON de la cuenta de servicio: copia solo el valor de private_key");
  }
  const recortado = valor.trim();
  if (recortado.startsWith('"') || recortado.endsWith('"') || recortado.startsWith("'")) {
    pistas.push("incluye comillas: en .env no hacen falta o están duplicadas");
  }
  return pistas;
}

/** Carga un archivo de entorno si existe; su ausencia no es un error (CI/Vercel). */
function cargarSiExiste(ruta: string): boolean {
  try {
    process.loadEnvFile(ruta);
    return true;
  } catch {
    // Sin archivo o ilegible: se sigue con el entorno del proceso.
    return false;
  }
}

/**
 * Carga `.env` del directorio actual para que el chequeo no diga «falta» cuando
 * el archivo sí existe. `.env.local` se lee primero porque tiene prioridad en
 * Next y `loadEnvFile` no sobrescribe lo ya definido. Nunca imprime valores.
 * Devuelve los nombres de los archivos que se pudieron leer.
 */
export function cargarArchivoEntorno(): string[] {
  const cargados: string[] = [];
  if (cargarSiExiste(".env.local")) {
    cargados.push(".env.local");
  }
  if (cargarSiExiste(".env")) {
    cargados.push(".env");
  }
  return cargados;
}

if (esEjecucionDirecta(import.meta.url, process.argv)) {
  const cargados = cargarArchivoEntorno();
  const { lineas, codigoSalida } = ejecutarVerificacion(process.env);
  const formato = validarFormato(process.env);
  const salida = [...lineas];
  if (cargados.length === 0) {
    salida.push("Archivos: ninguno encontrado (se usa el entorno del proceso).");
  }
  if (cargados.length > 0) {
    salida.push(`Archivos: ${cargados.join(", ")}.`);
  }
  if (formato.valido) {
    salida.push("Formato: válido.");
  }
  if (formato.campos.length > 0) {
    salida.push(`Formato: inválido en ${formato.campos.join(", ")}.`);
    if (formato.campos.includes("FIREBASE_PRIVATE_KEY")) {
      for (const pista of pistaClavePrivada(process.env.FIREBASE_PRIVATE_KEY)) {
        salida.push(`Pista FIREBASE_PRIVATE_KEY: ${pista}.`);
      }
    }
  }
  for (const linea of salida) {
    console.log(linea);
  }
  if (!formato.valido) {
    process.exit(1);
  }
  process.exit(codigoSalida);
}
