import type { DetalleError } from "@/shared/schema";

/**
 * Errores de dominio de la API (spec A0, R1).
 *
 * Cada clase lleva un único código HTTP fijo, un mensaje legible por defecto y
 * una marca `exponeDetalles` que solo `ErrorDeValidacion` activa. Desde un
 * servicio se lanza la subclase; `http.ts` la traduce a la respuesta JSON.
 */
export abstract class ErrorDeDominio extends Error {
  /** Código HTTP que le corresponde a esta clase (tabla de R1). */
  readonly codigo: number;
  /** `true` solo en el error de validación: el resto nunca expone detalles. */
  readonly exponeDetalles: boolean = false;

  constructor(codigo: number, mensaje: string) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
  }
}

/** 400: cuerpo o query que no pasan Zod; lleva `detalles` por campo. */
export class ErrorDeValidacion extends ErrorDeDominio {
  readonly detalles: readonly DetalleError[];
  /** Solo esta subclase activa la exposición de detalles. */
  readonly exponeDetalles: boolean;

  constructor(detalles: readonly DetalleError[], mensaje = "Datos inválidos") {
    super(400, mensaje);
    this.detalles = detalles;
    this.exponeDetalles = detalles.length > 0;
  }
}

/** 401: falta la sesión o el ID token no es válido. */
export class NoAutenticado extends ErrorDeDominio {
  constructor(mensaje = "Falta la sesión") {
    super(401, mensaje);
  }
}

/** 403: autenticado pero sin permiso (por ejemplo, sin el claim `admin`). */
export class NoAutorizado extends ErrorDeDominio {
  constructor(mensaje = "No tienes permiso para esta operación") {
    super(403, mensaje);
  }
}

/** 404: recurso inexistente o que pertenece a otra persona. */
export class NoEncontrado extends ErrorDeDominio {
  constructor(mensaje = "No se encontró el recurso") {
    super(404, mensaje);
  }
}

/** 409: duplicado (correo, teléfono) o conflicto de versión. */
export class Conflicto extends ErrorDeDominio {
  constructor(mensaje = "El recurso ya existe") {
    super(409, mensaje);
  }
}

/** 413: el cuerpo supera el límite permitido. */
export class DemasiadoGrande extends ErrorDeDominio {
  constructor(mensaje = "El cuerpo supera el tamaño permitido") {
    super(413, mensaje);
  }
}

/** 415: el `Content-Type` del cuerpo no es `application/json`. */
export class NoSoportado extends ErrorDeDominio {
  constructor(mensaje = "El cuerpo debe ser JSON") {
    super(415, mensaje);
  }
}

/** 429: demasiados intentos en la ventana de tiempo. */
export class DemasiadosIntentos extends ErrorDeDominio {
  constructor(mensaje = "Demasiados intentos, inténtalo más tarde") {
    super(429, mensaje);
  }
}

/** 500: fallo inesperado; la respuesta pública nunca lleva detalles ni stack. */
export class ErrorInterno extends ErrorDeDominio {
  constructor(mensaje = "Error interno") {
    super(500, mensaje);
  }
}

/**
 * Configuración incompleta o inválida (R5). Es un `ErrorInterno`: el detalle
 * dice **qué variable** falla, nunca su valor, y solo acaba en los logs.
 */
export class ErrorDeConfiguracion extends ErrorInterno {
  constructor(mensaje: string) {
    super(mensaje);
  }
}

/** `true` si el valor es un error de dominio (aunque venga de otro módulo). */
export function esErrorDeDominio(error: object): error is ErrorDeDominio {
  return error instanceof ErrorDeDominio;
}
