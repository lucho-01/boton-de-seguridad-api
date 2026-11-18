import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import type { ErrorHttp } from "@/shared/schema";
import {
  DemasiadoGrande,
  ErrorDeDominio,
  ErrorInterno,
  ErrorDeValidacion,
  NoAutenticado,
  NoSoportado,
} from "@/shared/server/errors";

/**
 * Frontera HTTP compartida (spec A0, R1–R3, R10).
 *
 * `route.ts` valida con Zod, llama al servicio y deja que `manejar` traduzca:
 * un error de dominio → su código con `{ error, detalles? }`; cualquier otra
 * cosa → `500 { "error": "Error interno" }` y un log sin datos personales.
 */

/** Máximo de `Authorization` aceptado: un ID token de Firebase ronda 1–2 KB. */
export const MAXIMO_TOKEN = 4096;

/** Tope de cuerpo por petición (64 KB). */
export const MAXIMO_CUERPO_BYTES = 64 * 1024;

/** Máximo de detalles de validación devueltos. */
export const MAXIMO_DETALLES = 10;

const TIPO_JSON = "application/json";
const PREFIJO_BEARER = "Bearer ";
const MENSAJE_ERROR_INTERNO = "Error interno";
const FORMATO_TOKEN = /^[A-Za-z0-9._~-]+$/;
const ESPACIO = " ";

/** Cuerpo JSON con el estado pedido; `no-store` para que nunca se cachee. */
export function responderJson(cuerpo: object, estado: number): NextResponse {
  return NextResponse.json(cuerpo, {
    status: estado,
    headers: { "Cache-Control": "no-store" },
  });
}

type Detalle = NonNullable<ErrorHttp["detalles"]>[number];

/** Respuesta de error uniforme: `{ error }` o `{ error, detalles }`. */
export function respuestaDeError(error: ErrorDeDominio): NextResponse {
  if (error.codigo >= 500) {
    const interno: ErrorHttp = { error: MENSAJE_ERROR_INTERNO };
    return responderJson(interno, 500);
  }
  if (error instanceof ErrorDeValidacion && error.exponeDetalles) {
    const conDetalles: ErrorHttp = {
      error: error.message,
      detalles: error.detalles.slice(0, MAXIMO_DETALLES).map((detalle) => ({ ...detalle })),
    };
    return responderJson(conDetalles, error.codigo);
  }
  const simple: ErrorHttp = { error: error.message };
  return responderJson(simple, error.codigo);
}

type ProblemaDeZod = {
  code: string;
  path: readonly PropertyKey[];
  message: string;
};

type ProblemaOrdenado = {
  campo: string;
  mensaje: string;
  orden: number;
};

/**
 * Valida un valor externo (cuerpo, query, token) con Zod. Un fallo se
 * convierte en `ErrorDeValidacion` con `detalles: [{ campo, mensaje }]`, en
 * orden estable por campo y con `MAXIMO_DETALLES` entradas como máximo.
 */
export function parseoZod<Salida>(esquema: ZodType<Salida>, valor: object): Salida {
  const leido = esquema.safeParse(valor);
  if (leido.success) {
    return leido.data;
  }
  throw new ErrorDeValidacion(detallesDeZod(leido.error.issues));
}

/** Detalles estables: por campo y luego por mensaje; sin repetir el mismo par. */
function detallesDeZod(problemas: readonly ProblemaDeZod[]): Detalle[] {
  const ordenados: ProblemaOrdenado[] = problemas.map((problema, indice) => {
    return {
      campo: problema.path.map((parte) => String(parte)).join("."),
      mensaje: problema.message,
      orden: indice,
    };
  });
  ordenados.sort(compararProblemas);
  const detalles: Detalle[] = [];
  const vistos = new Set<string>();
  for (const problema of ordenados) {
    const llave = `${problema.campo}\u0000${problema.mensaje}`;
    if (vistos.has(llave)) {
      continue;
    }
    vistos.add(llave);
    detalles.push({ campo: problema.campo, mensaje: problema.mensaje });
    if (detalles.length >= MAXIMO_DETALLES) {
      break;
    }
  }
  return detalles;
}

function compararProblemas(a: ProblemaOrdenado, b: ProblemaOrdenado): number {
  if (a.campo < b.campo) {
    return -1;
  }
  if (a.campo > b.campo) {
    return 1;
  }
  if (a.mensaje < b.mensaje) {
    return -1;
  }
  if (a.mensaje > b.mensaje) {
    return 1;
  }
  return a.orden - b.orden;
}

/**
 * Lee `Authorization: Bearer <token>` (R3). Debe ser exactamente el esquema
 * `Bearer` con mayúscula y un espacio; `bearer`/`Basic`/`Bearer ` o un token
 * con espacios, comillas o de más de `MAXIMO_TOKEN` → `401`.
 */
export function leerBearer(peticion: Request): string {
  const cabecera = peticion.headers.get("authorization");
  if (cabecera === null) {
    throw new NoAutenticado("Falta la sesión");
  }
  const token = extraerToken(cabecera);
  if (token === null) {
    throw new NoAutenticado("Sesión inválida o vencida");
  }
  return token;
}

function extraerToken(cabecera: string): string | null {
  if (!cabecera.startsWith(PREFIJO_BEARER)) {
    return null;
  }
  const token = cabecera.slice(PREFIJO_BEARER.length);
  if (token.length === 0 || token.length > MAXIMO_TOKEN) {
    return null;
  }
  if (token.includes(ESPACIO) || token.includes("\t")) {
    return null;
  }
  if (!FORMATO_TOKEN.test(token)) {
    return null;
  }
  return token;
}

/**
 * Exige `Content-Type: application/json` (criterio 12). Acepta el `charset`
 * que añaden los clientes (`application/json; charset=utf-8`) y la variante
 * `+json`; cualquier otra cosa → `415`.
 */
export function exigirJson(peticion: Request): void {
  const crudo = peticion.headers.get("content-type");
  if (crudo === null) {
    throw new NoSoportado("El cuerpo debe ser JSON (Content-Type: application/json)");
  }
  const [tipo = ""] = crudo.split(";");
  const normalizado = tipo.trim().toLowerCase();
  if (normalizado === TIPO_JSON || normalizado.endsWith("+json")) {
    return;
  }
  throw new NoSoportado("El cuerpo debe ser JSON (Content-Type: application/json)");
}

/**
 * Lee el texto del cuerpo JSON de una petición ya comprobada con `exigirJson`.
 * Con `Content-Length` declarado por encima del máximo → `413`; sin él se lee
 * con tope para no acumular un cuerpo enorme en memoria.
 */
export async function leerCuerpo(peticion: Request): Promise<string> {
  exigirJson(peticion);
  const declarado = leerLongitudDeclarada(peticion);
  if (declarado !== null && declarado > MAXIMO_CUERPO_BYTES) {
    throw new DemasiadoGrande("El cuerpo supera el tamaño permitido");
  }
  const texto = await leerTextoConTope(peticion, MAXIMO_CUERPO_BYTES);
  if (new TextEncoder().encode(texto).byteLength > MAXIMO_CUERPO_BYTES) {
    throw new DemasiadoGrande("El cuerpo supera el tamaño permitido");
  }
  return texto;
}

function leerLongitudDeclarada(peticion: Request): number | null {
  const crudo = peticion.headers.get("content-length");
  if (crudo === null) {
    return null;
  }
  const valor = Number(crudo);
  if (!Number.isFinite(valor) || valor < 0) {
    return null;
  }
  return valor;
}

/** Lee texto con tope; un cuerpo enorme nunca se acumula entero. */
async function leerTextoConTope(peticion: Request, tope: number): Promise<string> {
  if (peticion.body === null) {
    return "";
  }
  const lector = peticion.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const leido = await lector.read();
    if (leido.done) {
      break;
    }
    total += leido.value.byteLength;
    if (total > tope) {
      await lector.cancel();
      throw new DemasiadoGrande("El cuerpo supera el tamaño permitido");
    }
    trozos.push(leido.value);
  }
  const buffer = new Uint8Array(total);
  let posicion = 0;
  for (const trozo of trozos) {
    buffer.set(trozo, posicion);
    posicion += trozo.byteLength;
  }
  return new TextDecoder().decode(buffer);
}

const CuerpoJsonSchema = z.object({}).loose();

/**
 * Lee el cuerpo JSON de una petición y lo valida con `esquema`. El JSON se
 * parsea en el mismo punto en que se valida (regla 1 de `AGENTS.md`). Si el
 * cuerpo llega vacío se valida `{}` para que Zod produzca los detalles.
 */
export async function leerJson<Salida>(
  peticion: Request,
  esquema: ZodType<Salida>,
): Promise<Salida> {
  const texto = await leerCuerpo(peticion);
  let crudo: object = {};
  if (texto.trim().length > 0) {
    crudo = CuerpoJsonSchema.parse(JSON.parse(texto));
  }
  return parseoZod(esquema, crudo);
}

/**
 * Envuelve el handler de una ruta y traduce lo que salga (R1, R2):
 * - error de dominio → su código HTTP;
 * - JSON malformado o cuerpo vacío al parsear → `400` con `detalles`;
 * - cualquier otra cosa → `500 { "error": "Error interno" }`.
 * El `catch` no re-lanza, así que la promesa devuelta siempre resuelve.
 */
export function manejar(
  controlador: (peticion: Request) => Promise<Response> | Response,
): (peticion: Request) => Promise<Response> {
  return async function ruta(peticion: Request): Promise<Response> {
    try {
      return await controlador(peticion);
    } catch (capturado) {
      return responderFallo(capturado!);
    }
  };
}

/**
 * Variante de `manejar` para rutas dinámicas (`app/<x>/[id]/route.ts`). En
 * Next 16 el segundo argumento del handler es un contexto con
 * `params: Promise<{ id: string }>`; esta envoltura lo entrega al controlador
 * y traduce los fallos exactamente igual que `manejar`. No hay estado
 * compartido entre peticiones.
 */
export function manejarConContexto<Contexto>(
  controlador: (peticion: Request, contexto: Contexto) => Promise<Response> | Response,
): (peticion: Request, contexto: Contexto) => Promise<Response> {
  return async function ruta(peticion: Request, contexto: Contexto): Promise<Response> {
    try {
      return await controlador(peticion, contexto);
    } catch (capturado) {
      return responderFallo(capturado!);
    }
  };
}

/** Traduce el fallo de una ruta; se llama dentro del `catch` de `manejar`. */
function responderFallo(fallo: Error | object): Response {
  if (fallo instanceof ErrorDeDominio) {
    return respuestaDeError(fallo);
  }
  if (fallo instanceof SyntaxError) {
    return respuestaDeError(
      new ErrorDeValidacion([{ campo: "cuerpo", mensaje: "El cuerpo no es JSON válido" }]),
    );
  }
  console.error("[api] error inesperado", resumirErrorNoEsperado(fallo));
  return respuestaDeError(new ErrorInterno());
}

/** Log de un error no esperado: tipo y ubicación, nunca mensaje ni datos. */
function resumirErrorNoEsperado(error: object): { tipo: string; ubicacion: string } {
  if (!(error instanceof Error)) {
    return { tipo: typeof error, ubicacion: "sin pila" };
  }
  if (error.stack === undefined) {
    return { tipo: error.name, ubicacion: "sin pila" };
  }
  const lineas = error.stack.split("\n");
  return { tipo: error.name, ubicacion: lineas[1]?.trim() ?? "sin pila" };
}
