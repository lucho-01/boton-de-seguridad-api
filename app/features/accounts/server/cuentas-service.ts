import {
  type Login,
  type Ok,
  OkSchema,
  type Refresh,
  type Registro,
  type RespuestaCuenta,
  RespuestaCuentaSchema,
  type RespuestaYo,
  RespuestaYoSchema,
  type Sesion,
  type TokensSesion,
  TokensSesionSchema,
} from "@/shared/schema";
import {
  Conflicto,
  DemasiadosIntentos,
  ErrorDeValidacion,
  ErrorInterno,
  NoAutenticado,
  NoAutorizado,
} from "@/shared/server/errors";
import type { VerificadorDeToken } from "@/shared/server/session";
import { aIso, type Reloj } from "@/shared/server/time";
import {
  type AuthRespuesta,
  type ClienteAuth,
  type CodigoFirebase,
} from "@/shared/server/auth-client";
import { MENSAJE_LIMITE } from "./intentos";
import type { ContextoLogin, ServicioIntentos } from "./intentos-service";
import type { RepositorioPerfil } from "./repository";

/**
 * Reglas de negocio de las cuentas (spec A1, §4, §5, §6).
 *
 * Registro en tres pasos con rollback (R4, criterio 14): crear cuenta →
 * asignar claim `rol = "usuario"` → crear `usuarios/{uid}`. Si un paso
 * posterior a la creación falla, se borra la cuenta y se responde 500.
 * Los mensajes 4xx son literales del dominio y nunca interpolan correo ni token.
 */

/** Mensajes literales de la tabla de la spec A1 §6. */
export const MENSAJES_CUENTA = {
  correoRegistrado: "El correo ya está registrado",
  credencialesInvalidas: "Correo o contraseña incorrectos",
  contrasenaDebil: "La contraseña es demasiado débil",
  cuentaDeshabilitada: "La cuenta está deshabilitada",
  demasiadosIntentos: MENSAJE_LIMITE,
} as const;

/** Rol inicial de toda cuenta creada por la API (spec A1 §5). */
const ROL_INICIAL = "usuario" as const;

/**
 * Tabla de traducción del §6: un lugar, no cadenas de `if`. La función crea un
 * error nuevo en cada llamada (los errores se lanzan, no se comparten).
 */
const TRADUCCIONES: Record<CodigoFirebase, () => Error> = {
  EMAIL_EXISTS: () => new Conflicto(MENSAJES_CUENTA.correoRegistrado),
  EMAIL_NOT_FOUND: () => new NoAutenticado(MENSAJES_CUENTA.credencialesInvalidas),
  INVALID_PASSWORD: () => new NoAutenticado(MENSAJES_CUENTA.credencialesInvalidas),
  INVALID_LOGIN_CREDENTIALS: () => new NoAutenticado(MENSAJES_CUENTA.credencialesInvalidas),
  INVALID_EMAIL: () => new NoAutenticado(MENSAJES_CUENTA.credencialesInvalidas),
  WEAK_PASSWORD: () => new ErrorDeValidacion([], MENSAJES_CUENTA.contrasenaDebil),
  USER_DISABLED: () => new NoAutorizado(MENSAJES_CUENTA.cuentaDeshabilitada),
  TOO_MANY_ATTEMPTS_TRY_LATER: () => new DemasiadosIntentos(MENSAJES_CUENTA.demasiadosIntentos),
  INVALID_REFRESH_TOKEN: () => new NoAutenticado(),
  USER_NOT_FOUND: () => new NoAutenticado(),
  TOKEN_EXPIRED: () => new NoAutenticado(),
  CONFIGURATION_NOT_FOUND: () => new ErrorInterno(),
  DESCONOCIDO: () => new ErrorInterno(),
  RED: () => new ErrorInterno(),
};

/** Dependencias del servicio, todas inyectadas. */
export type DependenciasCuentas = {
  clienteAuth: ClienteAuth;
  repositorio: RepositorioPerfil;
  verificador: VerificadorDeToken;
  reloj: Reloj;
  intentos: ServicioIntentos;
};

/** Cara del servicio que usan las rutas. */
export type ServicioCuentas = {
  registrar(datos: Registro): Promise<RespuestaCuenta>;
  iniciarSesion(datos: Login, contexto?: ContextoLogin): Promise<RespuestaCuenta>;
  renovar(datos: Refresh): Promise<TokensSesion>;
  yo(sesion: Sesion): Promise<RespuestaYo>;
  /** Borra la cuenta y todos sus datos con el `uid` de la sesión (spec A4). */
  borrarCuenta(sesion: Sesion): Promise<Ok>;
};

/** Rol público del usuario: el del token verificado; sin claim, `usuario` (R3). */
function rolPublico(sesion: Sesion): "usuario" | "admin" {
  if (sesion.rol === "admin") {
    return "admin";
  }
  return "usuario";
}

/** Correo público: el del token o, si faltara, el del perfil (R10). */
function correoPublico(sesion: Sesion, correoDeRespaldo: string | null): string {
  if (sesion.email !== undefined) {
    return sesion.email;
  }
  if (correoDeRespaldo !== null) {
    return correoDeRespaldo;
  }
  return "";
}

/** `true` si el texto es uno de los códigos conocidos (tabla del §6). */
function esCodigoFirebase(valor: string): valor is CodigoFirebase {
  return Object.hasOwn(TRADUCCIONES, valor);
}

/** Extrae el `codigoFirebase` de un `ErrorDeCuenta` con una comprobación de forma. */
function codigoDeCuenta(capturado: object): CodigoFirebase | null {
  if (!("codigoFirebase" in capturado)) {
    return null;
  }
  const valor = capturado.codigoFirebase;
  if (typeof valor !== "string") {
    return null;
  }
  if (!esCodigoFirebase(valor)) {
    return null;
  }
  return valor;
}

/** Traduce el fallo de `ClienteAuth` a un error de dominio (§6); lo demás es 500. */
function traducir(capturado: object): Error {
  const codigo = codigoDeCuenta(capturado);
  if (codigo === null) {
    return new ErrorInterno();
  }
  const crear = TRADUCCIONES[codigo];
  return crear();
}

/**
 * `true` solo para los fallos que significan «credenciales inválidas» (A6, R4).
 * Los demás códigos (cuenta deshabilitada, red, configuración) no cuentan.
 */
function esFalloDeCredenciales(codigo: CodigoFirebase | null): boolean {
  if (codigo === "EMAIL_NOT_FOUND") {
    return true;
  }
  if (codigo === "INVALID_PASSWORD") {
    return true;
  }
  if (codigo === "INVALID_LOGIN_CREDENTIALS") {
    return true;
  }
  if (codigo === "INVALID_EMAIL") {
    return true;
  }
  return false;
}

/** Tipo de un fallo para logs; nunca su mensaje. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Dependencias mínimas del borrado de cuenta (spec A4). */
type DependenciasBorrado = Pick<DependenciasCuentas, "clienteAuth" | "repositorio">;

/** Respuesta de registro/login con el usuario construido desde el token verificado. */
async function respuestaDeCuenta(
  verificador: VerificadorDeToken,
  emitida: AuthRespuesta,
): Promise<RespuestaCuenta> {
  const sesion = await verificador.verificar(emitida.idToken);
  return RespuestaCuentaSchema.parse({
    token: emitida.idToken,
    refreshToken: emitida.refreshToken,
    expiraEnSeg: emitida.expiraEnSeg,
    usuario: {
      id: sesion.uid,
      email: correoPublico(sesion, emitida.email),
      rol: rolPublico(sesion),
    },
  });
}

/**
 * Borra la cuenta y todo su dato privado (spec A4, R3–R7; ADR-0010).
 *
 * Primero Firestore (`usuarios/{uid}` completo: perfil, contactos y alertas) y
 * después la cuenta de Auth: si el primero falla, la cuenta sigue utilizable y
 * el reintento completa el borrado. Si Auth ya no existe (`USER_NOT_FOUND`), se
 * considera éxito. Cualquier otro fallo → 500 opaco. El `uid` sale **solo** de
 * la sesión verificada (R2).
 */
async function borrarCuentaDe(dependencias: DependenciasBorrado, sesion: Sesion): Promise<Ok> {
  const { clienteAuth, repositorio } = dependencias;
  try {
    await repositorio.borrarTodo(sesion.uid);
  } catch (capturado) {
    console.error("[cuentas] no se pudo borrar los datos de la cuenta", {
      tipo: describirTipo(capturado!),
    });
    throw new ErrorInterno();
  }
  try {
    await clienteAuth.eliminarCuenta(sesion.uid);
  } catch (capturado) {
    const codigo = codigoDeCuenta(capturado!);
    if (codigo === "USER_NOT_FOUND") {
      return OkSchema.parse({ ok: true });
    }
    console.error("[cuentas] no se pudo borrar la cuenta de Auth", {
      tipo: describirTipo(capturado!),
    });
    throw new ErrorInterno();
  }
  return OkSchema.parse({ ok: true });
}

/** Crea el servicio con sus dependencias (spec A1, §4). */
export function crearServicioCuentas(dependencias: DependenciasCuentas): ServicioCuentas {
  const { clienteAuth, repositorio, verificador, reloj, intentos } = dependencias;

  /** Rollback del registro: borra la cuenta recién creada (criterio 14). */
  async function deshacerCuenta(uid: string): Promise<never> {
    try {
      await clienteAuth.eliminarCuenta(uid);
    } catch (capturado) {
      console.error("[cuentas] no se pudo deshacer la cuenta creada", {
        tipo: describirTipo(capturado!),
      });
    }
    throw new ErrorInterno();
  }

  async function registrar(datos: Registro): Promise<RespuestaCuenta> {
    let emitida: AuthRespuesta;
    try {
      emitida = await clienteAuth.registrar({ email: datos.email, password: datos.password });
    } catch (capturado) {
      throw traducir(capturado!);
    }
    try {
      await clienteAuth.asignarRol(emitida.uid, ROL_INICIAL);
      await repositorio.crear({
        uid: emitida.uid,
        email: datos.email,
        rol: ROL_INICIAL,
        perfil: datos.perfil,
        creadoEn: aIso(reloj.ahora()),
      });
      // La respuesta también se arma dentro del try: si la verificación del ID
      // token falla, la cuenta no puede quedar huérfana (R4).
      return await respuestaDeCuenta(verificador, emitida);
    } catch {
      return deshacerCuenta(emitida.uid);
    }
  }

  async function iniciarSesion(
    datos: Login,
    contexto: ContextoLogin = { ip: null },
  ): Promise<RespuestaCuenta> {
    await intentos.verificar(datos, contexto.ip);
    let emitida: AuthRespuesta;
    try {
      emitida = await clienteAuth.iniciarSesion({ email: datos.email, password: datos.password });
    } catch (capturado) {
      const codigo = codigoDeCuenta(capturado!);
      if (esFalloDeCredenciales(codigo)) {
        await intentos.registrarFallo(datos, contexto.ip);
      }
      throw traducir(capturado!);
    }
    await intentos.reiniciar(datos, contexto.ip);
    return respuestaDeCuenta(verificador, emitida);
  }

  async function renovar(datos: Refresh): Promise<TokensSesion> {
    let emitida: AuthRespuesta;
    try {
      emitida = await clienteAuth.renovar({ refreshToken: datos.refreshToken });
    } catch (capturado) {
      throw traducir(capturado!);
    }
    return TokensSesionSchema.parse({
      token: emitida.idToken,
      refreshToken: emitida.refreshToken,
      expiraEnSeg: emitida.expiraEnSeg,
    });
  }

  async function yo(sesion: Sesion): Promise<RespuestaYo> {
    let correoDelPerfil: string | null = null;
    try {
      const perfil = await repositorio.obtener(sesion.uid);
      if (perfil !== null) {
        correoDelPerfil = perfil.email;
      }
    } catch {
      throw new ErrorInterno();
    }
    return RespuestaYoSchema.parse({
      usuario: {
        id: sesion.uid,
        email: correoPublico(sesion, correoDelPerfil),
        rol: rolPublico(sesion),
      },
    });
  }

  /** Borra la cuenta y todos sus datos con el `uid` de la sesión (spec A4). */
  async function borrarCuenta(sesion: Sesion): Promise<Ok> {
    return borrarCuentaDe({ clienteAuth, repositorio }, sesion);
  }

  return { registrar, iniciarSesion, renovar, yo, borrarCuenta };
}
