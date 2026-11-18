import { z } from "zod";
import { ErrorDeConfiguracion } from "@/shared/server/errors";

/**
 * Entorno de la API (spec A0, R5, R6, R8).
 *
 * Este es el **único** módulo de la API que lee `process.env` (junto con el CLI
 * `scripts/check-env.ts`). Valida con Zod, memoiza por proceso y nunca imprime
 * ni expone valores: los errores dicen qué variable falta, no cuánto vale.
 */

/** Variables obligatorias. `FIREBASE_WEB_API_KEY` la usa A1, pero es de despliegue. */
export const VARIABLES_OBLIGATORIAS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
] as const;

/** Variable opcional (lista separada por comas; vacía = sin CORS). */
export const VARIABLE_OPCIONAL = "CORS_ORIGINS" as const;

export type VariableEntorno = (typeof VARIABLES_OBLIGATORIAS)[number] | typeof VARIABLE_OPCIONAL;

/** Orden estable para tablas y pruebas: obligatorias primero, opcional al final. */
export const VARIABLES_ENTORNO: readonly VariableEntorno[] = [
  ...VARIABLES_OBLIGATORIAS,
  VARIABLE_OPCIONAL,
];

/** Estado de una variable sin revelar su contenido. */
export type EstadoVariable = "presente" | "falta" | "vacía";

/** Resultado de evaluar el entorno. */
export type EvaluacionEntorno = {
  variables: Record<VariableEntorno, EstadoVariable>;
  faltantes: VariableEntorno[];
  estaCompleto: boolean;
};

/** Entorno validado y resuelto que usan el resto de módulos. */
export type Entorno = {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_CLIENT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_WEB_API_KEY: string;
  CORS_ORIGINS: string[];
};

const MENSAJE_VALIDACION = "Configuración de entorno incompleta o inválida";

/** Un texto obligatorio: no vacío tras recortar. */
const TextoObligatorioSchema = z.string().trim().min(1);

/** Id del proyecto: el que Firebase admite en `projectId`. */
const ProyectoSchema = TextoObligatorioSchema.regex(
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
  "identificador de Firebase inválido",
);

/** Credencial de servicio: correo `…@…iam.gserviceaccount.com`. */
const CuentaServicioSchema = TextoObligatorioSchema.regex(
  /^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/,
  "correo de cuenta de servicio inválido",
);

/** Clave privada PEM (el `\n` literal se normaliza después). */
const ClavePrivadaSchema = TextoObligatorioSchema.refine((valor) => {
  const real = normalizarClavePrivada(valor);
  return real.includes("-----BEGIN") && real.includes("PRIVATE KEY-----");
}, "clave privada PEM inválida");

/**
 * Salto de línea real, no el texto `\n` que deja el panel de Vercel.
 * `split`/`join` en vez de `replace`: la regla del lint prohíbe ternarios y
 * `replace` devuelve el original cuando no encuentra nada.
 */
export function normalizarClavePrivada(valor: string): string {
  return valor.split("\\n").join("\n");
}

const EntornoSchema = z.object({
  FIREBASE_PROJECT_ID: ProyectoSchema,
  FIREBASE_CLIENT_EMAIL: CuentaServicioSchema,
  FIREBASE_PRIVATE_KEY: ClavePrivadaSchema,
  FIREBASE_WEB_API_KEY: TextoObligatorioSchema,
  CORS_ORIGINS: z.string().optional(),
});

/** `" a , b ,, c "` → `["a", "b", "c"]`; vacío o solo espacios → `[]`. */
export function interpretarOrigenes(valor: string): string[] {
  return valor
    .split(",")
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}

/**
 * Función pura: clasifica cada variable como `"presente"`, `"falta"` (no
 * definida) o `"vacía"` (definida sin contenido). No lee `process.env`; recibe
 * el entorno tal cual para que `check:env` y las pruebas la usen igual.
 */
export function evaluarEntorno(entrada: Record<string, string | undefined>): EvaluacionEntorno {
  const variables: Record<VariableEntorno, EstadoVariable> = {
    FIREBASE_PROJECT_ID: clasificar(entrada.FIREBASE_PROJECT_ID),
    FIREBASE_CLIENT_EMAIL: clasificar(entrada.FIREBASE_CLIENT_EMAIL),
    FIREBASE_PRIVATE_KEY: clasificar(entrada.FIREBASE_PRIVATE_KEY),
    FIREBASE_WEB_API_KEY: clasificar(entrada.FIREBASE_WEB_API_KEY),
    CORS_ORIGINS: clasificar(entrada.CORS_ORIGINS),
  };
  const faltantes = VARIABLES_OBLIGATORIAS.filter((nombre) => {
    return variables[nombre] !== "presente";
  });
  return {
    variables,
    faltantes: [...faltantes],
    estaCompleto: faltantes.length === 0,
  };
}

function clasificar(valor: string | undefined): EstadoVariable {
  if (valor === undefined) {
    return "falta";
  }
  if (valor.trim().length === 0) {
    return "vacía";
  }
  return "presente";
}

/** Nombres de los campos con formato inválido; vacío si todos encajan. */
export function camposInvalidos(entrada: Record<string, string | undefined>): string[] {
  const leido = EntornoSchema.safeParse(entrada);
  if (leido.success) {
    return [];
  }
  return leido.error.issues.map((problema) => {
    return problema.path.map(String).join(".");
  });
}

/** Valida un entorno leído; lanza `ErrorDeConfiguracion` nombrando lo que falta. */
export function validarEntorno(entrada: Record<string, string | undefined>): Entorno {
  const evaluacion = evaluarEntorno(entrada);
  if (!evaluacion.estaCompleto) {
    throw new ErrorDeConfiguracion(
      `${MENSAJE_VALIDACION}: obligatorias sin valor → ${evaluacion.faltantes.join(", ")}`,
    );
  }
  const campos = camposInvalidos(entrada);
  if (campos.length > 0) {
    throw new ErrorDeConfiguracion(`${MENSAJE_VALIDACION}: revisa ${campos.join(", ")}`);
  }
  const leido = EntornoSchema.parse(entrada);
  const origenes = leido.CORS_ORIGINS;
  let lista: string[] = [];
  if (origenes !== undefined) {
    lista = interpretarOrigenes(origenes);
  }
  return {
    FIREBASE_PROJECT_ID: leido.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: leido.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: normalizarClavePrivada(leido.FIREBASE_PRIVATE_KEY),
    FIREBASE_WEB_API_KEY: leido.FIREBASE_WEB_API_KEY,
    CORS_ORIGINS: lista,
  };
}

let memoizado: Entorno | null = null;

/** Entorno validado, una sola vez por proceso (R5). */
export function obtenerEntorno(): Entorno {
  if (memoizado === null) {
    memoizado = validarEntorno(process.env);
  }
  return memoizado;
}

/** Solo para pruebas: borra la memoización del proceso. */
export function reiniciarEntorno(): void {
  memoizado = null;
}

/** Resumen sin valores; sirve para `GET /api/health` y para los logs. */
export function evaluarEntornoActual(): EvaluacionEntorno {
  return evaluarEntorno(process.env);
}
