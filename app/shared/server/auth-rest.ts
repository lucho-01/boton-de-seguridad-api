import { z } from "zod";
import type { Rol } from "@/shared/schema";
import type {
  AuthRespuesta,
  ClienteAuth,
  CodigoFirebase,
  Credenciales,
  Renovacion,
} from "@/shared/server/auth-client";
import { ErrorDeCuenta } from "@/shared/server/auth-client";
import { obtenerEntorno } from "@/shared/server/env";
import { obtenerAuth } from "@/shared/server/firebase";

/**
 * Cliente real de Firebase Auth por REST (ADR-0002, ADR-0007).
 *
 * Es la única implementación del puerto `ClienteAuth`: llama a
 * `accounts:signUp`, `accounts:signInWithPassword` y `securetoken` con
 * `FIREBASE_WEB_API_KEY` (que nunca sale del servidor) y usa `firebase-admin`
 * para los claims y el borrado. Toda respuesta se valida con Zod en el mismo
 * punto y los fallos se traducen a `ErrorDeCuenta` con un código tipado.
 * Nunca se registra el cuerpo, la contraseña, el correo ni los tokens.
 */

/** Tiempo máximo por llamada a Firebase (ADR-0007). */
export const TIEMPO_LIMITE_MS = 10_000;

/** Raíz de Identity Platform (registro y login). */
const URL_IDENTITYTOOLKIT = "https://identitytoolkit.googleapis.com/v1";

/** Endpoint de renovación de tokens (`securetoken`). */
const URL_SECURETOKEN = "https://securetoken.googleapis.com/v1/token";

/** Códigos conocidos de Firebase Auth (spec A1, §6). La tabla es exhaustiva. */
const CODIGOS_POR_MENSAJE: Record<string, CodigoFirebase> = {
  EMAIL_EXISTS: "EMAIL_EXISTS",
  EMAIL_NOT_FOUND: "EMAIL_NOT_FOUND",
  INVALID_PASSWORD: "INVALID_PASSWORD",
  INVALID_LOGIN_CREDENTIALS: "INVALID_LOGIN_CREDENTIALS",
  INVALID_EMAIL: "INVALID_EMAIL",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  USER_DISABLED: "USER_DISABLED",
  TOO_MANY_ATTEMPTS_TRY_LATER: "TOO_MANY_ATTEMPTS_TRY_LATER",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  CONFIGURATION_NOT_FOUND: "CONFIGURATION_NOT_FOUND",
};

/** Sufijos de código de `firebase-admin` (llegan sin el prefijo `auth/`). */
const CODIGOS_POR_SUFIJO: ReadonlyArray<readonly [string, CodigoFirebase]> = [
  ["user-not-found", "USER_NOT_FOUND"],
  ["email-already-exists", "EMAIL_EXISTS"],
  ["configuration-not-found", "CONFIGURATION_NOT_FOUND"],
  ["invalid-email", "INVALID_EMAIL"],
  ["user-disabled", "USER_DISABLED"],
];

/** Respuesta de `accounts:signUp` y `accounts:signInWithPassword`. */
const SesionIdentidadSchema = z.object({
  localId: z.string().min(1),
  email: z.string().min(1),
  idToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresIn: z.string().min(1),
});

/** Respuesta de `securetoken`; no incluye correo. */
const SesionSecuretokenSchema = z.object({
  user_id: z.string().min(1),
  id_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.string().min(1),
});

/** Cuerpo de error de Firebase: `{ error: { message } }`. */
const ErrorFirebaseSchema = z.object({
  error: z.object({
    message: z.string().min(1),
  }),
});

/** Cuenta tal como la devuelve `getAuth().getUser()` (solo se lee el correo). */
const CuentaAdminSchema = z.object({
  email: z.string().min(1),
});

type Ubicacion = "registro" | "login" | "refresh" | "claim" | "borrado";

/** Log de un fallo de red o de Firebase: tipo y ubicación, nunca el mensaje. */
function registrarFallo(ubicacion: Ubicacion, fallo: object): void {
  const tipo: string = describirTipo(fallo);
  console.error("[auth-rest] fallo de Firebase Auth", { ubicacion, tipo });
}

/** Nombre del tipo del fallo; nunca su mensaje, el cuerpo ni tokens. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Convierte `expiresIn` (texto en segundos) en un entero positivo. */
function aSegundos(valor: string): number {
  const segundos = Number(valor);
  if (!Number.isInteger(segundos) || segundos <= 0) {
    throw new ErrorDeCuenta("DESCONOCIDO");
  }
  return segundos;
}

/** El mensaje llega como `CODE` o `CODE : detalle`; se queda el código. */
function codigoDelMensaje(mensaje: string): CodigoFirebase {
  const [crudo = ""] = mensaje.split(":");
  const conocido = CODIGOS_POR_MENSAJE[crudo.trim()];
  if (conocido === undefined) {
    return "DESCONOCIDO";
  }
  return conocido;
}

/** Código de error de una respuesta no exitosa; sin cuerpo válido, desconocido. */
async function codigoDeFallo(respuesta: Response, ubicacion: Ubicacion): Promise<CodigoFirebase> {
  let cuerpo: object;
  try {
    cuerpo = await respuesta.json();
  } catch (capturado) {
    registrarFallo(ubicacion, capturado!);
    return "DESCONOCIDO";
  }
  const leido = ErrorFirebaseSchema.safeParse(cuerpo);
  if (!leido.success) {
    return "DESCONOCIDO";
  }
  return codigoDelMensaje(leido.data.error.message);
}

type PeticionRest = {
  ubicacion: Ubicacion;
  url: string;
  cuerpo: Record<string, string>;
};

/** POST JSON a Firebase Auth: valida la respuesta o lanza `ErrorDeCuenta`. */
async function pedir<Salida>(peticion: PeticionRest, esquema: z.ZodType<Salida>): Promise<Salida> {
  let respuesta: Response;
  try {
    respuesta = await fetch(peticion.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(peticion.cuerpo),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
  } catch (capturado) {
    registrarFallo(peticion.ubicacion, capturado!);
    throw new ErrorDeCuenta("RED");
  }
  if (!respuesta.ok) {
    throw new ErrorDeCuenta(await codigoDeFallo(respuesta, peticion.ubicacion));
  }
  let crudo: object;
  try {
    crudo = await respuesta.json();
  } catch (capturado) {
    registrarFallo(peticion.ubicacion, capturado!);
    throw new ErrorDeCuenta("DESCONOCIDO");
  }
  const leido = esquema.safeParse(crudo);
  if (!leido.success) {
    throw new ErrorDeCuenta("DESCONOCIDO");
  }
  return leido.data;
}

/** URL de Identity Toolkit con la API key del entorno (nunca se registra). */
function urlIdentitytoolkit(operacion: string): string {
  const clave = encodeURIComponent(obtenerEntorno().FIREBASE_WEB_API_KEY);
  return `${URL_IDENTITYTOOLKIT}/${operacion}?key=${clave}`;
}

/** URL de `securetoken` con la API key del entorno (nunca se registra). */
function urlSecuretoken(): string {
  const clave = encodeURIComponent(obtenerEntorno().FIREBASE_WEB_API_KEY);
  return `${URL_SECURETOKEN}?key=${clave}`;
}

/** Respuesta de Identity Toolkit convertida al contrato interno. */
function aRespuestaIdentidad(leido: z.infer<typeof SesionIdentidadSchema>): AuthRespuesta {
  return {
    uid: leido.localId,
    email: leido.email,
    idToken: leido.idToken,
    refreshToken: leido.refreshToken,
    expiraEnSeg: aSegundos(leido.expiresIn),
  };
}

/** Cuerpo común de registro y login: email, contraseña y tokens de vuelta. */
function cuerpoDeCredenciales(datos: Credenciales): Record<string, string> {
  return { email: datos.email, password: datos.password, returnSecureToken: "true" };
}

/** Registra la cuenta con correo y contraseña (`accounts:signUp`). */
async function registrar(datos: Credenciales): Promise<AuthRespuesta> {
  const peticion: PeticionRest = {
    ubicacion: "registro",
    url: urlIdentitytoolkit("accounts:signUp"),
    cuerpo: cuerpoDeCredenciales(datos),
  };
  return aRespuestaIdentidad(await pedir(peticion, SesionIdentidadSchema));
}

/** Inicia sesión con correo y contraseña (`accounts:signInWithPassword`). */
async function iniciarSesion(datos: Credenciales): Promise<AuthRespuesta> {
  const peticion: PeticionRest = {
    ubicacion: "login",
    url: urlIdentitytoolkit("accounts:signInWithPassword"),
    cuerpo: cuerpoDeCredenciales(datos),
  };
  return aRespuestaIdentidad(await pedir(peticion, SesionIdentidadSchema));
}

/**
 * Correo de la cuenta tras renovar: `securetoken` no lo devuelve. Se lee de
 * Admin (`getUser`) y **solo** para devolver el dato; la identidad sigue
 * saliendo del ID token verificado en el servicio.
 */
async function correoDeCuenta(uid: string): Promise<string> {
  let cuenta: object;
  try {
    const auth = await obtenerAuth();
    cuenta = await auth.getUser(uid);
  } catch (capturado) {
    registrarFallo("refresh", capturado!);
    throw new ErrorDeCuenta(codigoDeAdmin(capturado!));
  }
  const leido = CuentaAdminSchema.safeParse(cuenta);
  if (!leido.success) {
    throw new ErrorDeCuenta("DESCONOCIDO");
  }
  return leido.data.email;
}

/** Renueva el ID token con el refresh token; Firebase rota ambos (R9). */
async function renovar(datos: Renovacion): Promise<AuthRespuesta> {
  const peticion: PeticionRest = {
    ubicacion: "refresh",
    url: urlSecuretoken(),
    cuerpo: { grant_type: "refresh_token", refresh_token: datos.refreshToken },
  };
  const leido = await pedir(peticion, SesionSecuretokenSchema);
  return {
    uid: leido.user_id,
    email: await correoDeCuenta(leido.user_id),
    idToken: leido.id_token,
    refreshToken: leido.refresh_token,
    expiraEnSeg: aSegundos(leido.expires_in),
  };
}

/** Mapa de código de `firebase-admin` (`auth/user-not-found`) al código de la API. */
const CODIGOS_POR_NOMBRE: Record<string, CodigoFirebase> = {
  "auth/email-already-exists": "EMAIL_EXISTS",
  "auth/email-already-in-use": "EMAIL_EXISTS",
  "auth/user-not-found": "USER_NOT_FOUND",
  "auth/user-disabled": "USER_DISABLED",
  "auth/invalid-email": "INVALID_EMAIL",
  "auth/invalid-password": "INVALID_PASSWORD",
  "auth/weak-password": "WEAK_PASSWORD",
  "auth/too-many-requests": "TOO_MANY_ATTEMPTS_TRY_LATER",
  "auth/id-token-expired": "TOKEN_EXPIRED",
  "auth/argument-error": "DESCONOCIDO",
};

/** Lee el `code` del error de Admin sin confiar en el texto. */
function nombreDeError(fallo: object): string | null {
  const conCodigo = z.object({ code: z.string() }).safeParse(fallo);
  if (!conCodigo.success) {
    return null;
  }
  return conCodigo.data.code;
}

/** Código tipado de un fallo de `firebase-admin`: primero `code`, luego el sufijo. */
function codigoDeAdmin(fallo: object): CodigoFirebase {
  const nombre = nombreDeError(fallo);
  if (nombre !== null) {
    const codigo = CODIGOS_POR_NOMBRE[nombre];
    if (codigo !== undefined) {
      return codigo;
    }
  }
  if (!(fallo instanceof Error)) {
    return "DESCONOCIDO";
  }
  for (const [sufijo, codigo] of CODIGOS_POR_SUFIJO) {
    if (fallo.message.endsWith(sufijo)) {
      return codigo;
    }
  }
  return "DESCONOCIDO";
}

/** Asigna el custom claim `rol` con Admin (R3, §5). */
async function asignarRol(uid: string, rol: Rol): Promise<void> {
  try {
    const auth = await obtenerAuth();
    await auth.setCustomUserClaims(uid, { rol });
  } catch (capturado) {
    registrarFallo("claim", capturado!);
    throw new ErrorDeCuenta(codigoDeAdmin(capturado!));
  }
}

/** Borra la cuenta con Admin; es el rollback del registro (R4). */
async function eliminarCuenta(uid: string): Promise<void> {
  try {
    const auth = await obtenerAuth();
    await auth.deleteUser(uid);
  } catch (capturado) {
    registrarFallo("borrado", capturado!);
    throw new ErrorDeCuenta(codigoDeAdmin(capturado!));
  }
}

/** Implementación real del puerto `ClienteAuth` (ADR-0007). */
export const clienteAuthRest: ClienteAuth = {
  registrar,
  iniciarSesion,
  renovar,
  asignarRol,
  eliminarCuenta,
};
