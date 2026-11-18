import type { Rol } from "@/shared/schema";

/**
 * Puerto del cliente de Firebase Auth (spec A1, §11; ADR-0007).
 *
 * Vive en `shared/server/` porque la implementación real
 * (`auth-rest.ts`) también es compartida y `app/shared` no puede importar
 * features. El consumidor es la feature `accounts`, que importa este archivo
 * directamente; `app/shared/server/index.ts` no lo reexporta. Las pruebas usan
 * un doble: cero red y cero Firebase.
 */

/** Códigos de Firebase Auth que la API sabe traducir (spec A1, §6). */
export const CODIGOS_FIREBASE = [
  "EMAIL_EXISTS",
  "EMAIL_NOT_FOUND",
  "INVALID_PASSWORD",
  "INVALID_LOGIN_CREDENTIALS",
  "INVALID_EMAIL",
  "WEAK_PASSWORD",
  "USER_DISABLED",
  "TOO_MANY_ATTEMPTS_TRY_LATER",
  "INVALID_REFRESH_TOKEN",
  "USER_NOT_FOUND",
  "TOKEN_EXPIRED",
  "CONFIGURATION_NOT_FOUND",
  "DESCONOCIDO",
  "RED",
] as const;

/** Código de fallo de Firebase Auth, ya tipado. */
export type CodigoFirebase = (typeof CODIGOS_FIREBASE)[number];

/** Datos mínimos para crear o validar una contraseña. */
export type Credenciales = {
  email: string;
  password: string;
};

/** Sesión emitida por Firebase Auth: ID token, refresh token y su vigencia. */
export type AuthRespuesta = {
  uid: string;
  email: string;
  idToken: string;
  refreshToken: string;
  expiraEnSeg: number;
};

/** Datos para renovar la sesión (spec A1, R9). */
export type Renovacion = {
  refreshToken: string;
};

/**
 * Fallo de Firebase Auth. El `codigoFirebase` es lo único que el servicio
 * mira; el mensaje original y la respuesta HTTP no se propagan.
 */
export class ErrorDeCuenta extends Error {
  readonly codigoFirebase: CodigoFirebase;

  constructor(codigoFirebase: CodigoFirebase) {
    super(`Firebase Auth falló (${codigoFirebase})`);
    this.name = "ErrorDeCuenta";
    this.codigoFirebase = codigoFirebase;
  }
}

/** Puerto del cliente de Firebase Auth. */
export type ClienteAuth = {
  /** Crea la cuenta (`accounts:signUp`). */
  registrar(datos: Credenciales): Promise<AuthRespuesta>;
  /** Valida la contraseña (`accounts:signInWithPassword`). */
  iniciarSesion(datos: Credenciales): Promise<AuthRespuesta>;
  /** Renueva el ID token y rota el refresh token (`securetoken`). */
  renovar(datos: Renovacion): Promise<AuthRespuesta>;
  /** Asigna el custom claim `rol` (R3, §5). */
  asignarRol(uid: string, rol: Rol): Promise<void>;
  /** Borra la cuenta recién creada si un paso posterior falla (R4). */
  eliminarCuenta(uid: string): Promise<void>;
};
