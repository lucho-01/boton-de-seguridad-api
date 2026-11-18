import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ErrorHttpSchema } from "../schema";
import {
  Conflicto,
  DemasiadoGrande,
  DemasiadosIntentos,
  ErrorDeValidacion,
  ErrorInterno,
  NoAutenticado,
  NoAutorizado,
  NoEncontrado,
  NoSoportado,
} from "../server/errors";
import {
  exigirJson,
  leerBearer,
  leerCuerpo,
  manejar,
  MAXIMO_CUERPO_BYTES,
  MAXIMO_DETALLES,
  MAXIMO_TOKEN,
  parseoZod,
  respuestaDeError,
} from "../server/http";

const DetalleErrorSchema = z.object({ campo: z.string(), mensaje: z.string() });
const CuerpoSchema = z.object({ nombre: z.string(), telefono: z.string() });

/** La única forma permitida de leer el cuerpo: validándolo con Zod. */
async function leerCuerpoError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

async function leerComoTexto(respuesta: Response): Promise<string> {
  return respuesta.clone().text();
}

function peticionJson(cuerpo: string, tipo = "application/json") {
  return new Request("http://localhost/api/privada", {
    method: "POST",
    headers: { "content-type": tipo },
    body: cuerpo,
  });
}

async function errorDe(
  promesa: Promise<unknown> | (() => Promise<unknown> | void),
): Promise<Error> {
  try {
    if (typeof promesa === "function") {
      await promesa();
    } else {
      await promesa;
    }
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error("La prueba esperaba una instancia de Error");
  }
  throw new Error("La prueba esperaba un rechazo y resolvió");
}

describe("A0 §8.1 · error de dominio se traduce a HTTP uniforme", () => {
  it("NoEncontrado('Contacto no existe') → 404 { error: 'Contacto no existe' }", async () => {
    const respuesta = respuestaDeError(new NoEncontrado("Contacto no existe"));
    expect(respuesta.status).toBe(404);
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo.error).toBe("Contacto no existe");
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("cada clase de dominio usa el código único fijado por la tabla", async () => {
    const tabla = [
      { error: new NoAutenticado("Falta la sesión"), estado: 401 },
      { error: new NoAutorizado("Sin permiso"), estado: 403 },
      { error: new NoEncontrado("No existe"), estado: 404 },
      { error: new Conflicto("Duplicado"), estado: 409 },
      { error: new DemasiadoGrande("Cuerpo demasiado grande"), estado: 413 },
      { error: new NoSoportado("Content-Type no JSON"), estado: 415 },
      { error: new DemasiadosIntentos("Demasiados intentos"), estado: 429 },
    ];
    for (const caso of tabla) {
      const respuesta = respuestaDeError(caso.error);
      expect(respuesta.status, caso.error.constructor.name).toBe(caso.estado);
      const cuerpo = await leerCuerpoError(respuesta);
      expect(cuerpo.error).toBe(caso.error.message);
    }
  });

  it("manejar() traduce un error lanzado por el controlador al mismo cuerpo", async () => {
    const ruta = manejar(function controlador(): Response {
      throw new NoEncontrado("Contacto no existe");
    });
    const respuesta = await ruta(new Request("http://localhost/api/x"));
    expect(respuesta.status).toBe(404);
    expect(await leerCuerpoError(respuesta)).toEqual({ error: "Contacto no existe" });
  });
});

describe("A0 §8.2 · error desconocido responde 500 sin filtrar el original", () => {
  it("new Error('boom') → 500 { error: 'Error interno' }", async () => {
    const ruta = manejar(function controlador(): Response {
      throw new Error("boom");
    });
    const respuesta = await ruta(new Request("http://localhost/api/x"));
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo).toEqual({ error: "Error interno" });
  });

  it("el cuerpo nunca contiene 'boom' ni rastros de pila", async () => {
    const ruta = manejar(function controlador(): Response {
      throw new Error("boom");
    });
    const respuesta = await ruta(new Request("http://localhost/api/x"));
    const texto = await leerComoTexto(respuesta);
    expect(texto).not.toContain("boom");
    expect(texto).not.toContain(".ts");
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("ErrorInterno responde un 500 opaco aunque lleve un mensaje interno", async () => {
    const respuesta = respuestaDeError(new ErrorInterno("detalle interno con telefono 555"));
    expect(respuesta.status).toBe(500);
    const texto = await leerComoTexto(respuesta);
    expect(texto).not.toContain("555");
    expect(await leerCuerpoError(respuesta)).toEqual({ error: "Error interno" });
  });

  it("un valor no-Error lanzado también cae en 500 opaco", async () => {
    const ruta = manejar(function controlador(): Response {
      throw { raro: true };
    });
    const respuesta = await ruta(new Request("http://localhost/api/x"));
    expect(respuesta.status).toBe(500);
    expect(await leerCuerpoError(respuesta)).toEqual({ error: "Error interno" });
  });
});

describe("A0 §8.3 · ZodError → 400 con detalles por campo", () => {
  it("un valor inválido en 'telefono' produce detalles[0].campo = 'telefono'", async () => {
    const error = await errorDe(() => {
      parseoZod(CuerpoSchema, { nombre: "Ana", telefono: 12 });
    });
    const respuesta = respuestaDeError(error as ErrorDeValidacion);
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerCuerpoError(respuesta);
    const primero = cuerpo.detalles?.[0];
    expect(primero).toBeDefined();
    expect(primero?.campo).toBe("telefono");
    expect(typeof primero?.mensaje).toBe("string");
  });

  it("campos anidados se reportan con ruta con puntos", async () => {
    const esquema = z.object({ contacto: z.object({ telefono: z.string() }) });
    const error = await errorDe(() => {
      parseoZod(esquema, { contacto: { telefono: 1 } });
    });
    const respuesta = respuestaDeError(error as ErrorDeValidacion);
    const campos = ((await leerCuerpoError(respuesta)).detalles ?? []).map(
      (detalle) => detalle.campo,
    );
    expect(campos).toContain("contacto.telefono");
  });

  it("más de 10 errores se recortan a exactamente 10 detalles", async () => {
    const forma = Object.fromEntries(
      Array.from({ length: 15 }, (_, indice) => [`campo_${indice}`, z.string()]),
    );
    const esquema = z.object(forma);
    const error = await errorDe(() => {
      parseoZod(esquema, {});
    });
    const respuesta = respuestaDeError(error as ErrorDeValidacion);
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo.detalles).toHaveLength(MAXIMO_DETALLES);
    expect(MAXIMO_DETALLES).toBe(10);
  });

  it("cada detalle cumple { campo, mensaje } en texto", async () => {
    const error = await errorDe(() => {
      parseoZod(CuerpoSchema, { nombre: 1, telefono: 2 });
    });
    const respuesta = respuestaDeError(error as ErrorDeValidacion);
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo.detalles?.length).toBeGreaterThanOrEqual(1);
    for (const detalle of cuerpo.detalles ?? []) {
      const validado = DetalleErrorSchema.parse(detalle);
      expect(validado.campo.length).toBeGreaterThan(0);
      expect(validado.mensaje.length).toBeGreaterThan(0);
    }
  });
});

describe("A0 §3 y §8 · forma uniforme { error, detalles? }", () => {
  it("todas las respuestas de error cumplen ErrorHttpSchema", async () => {
    const casos = [
      new NoAutenticado("Falta la sesión"),
      new NoAutorizado("Sin permiso"),
      new NoEncontrado("Contacto no existe"),
      new Conflicto("Correo ya registrado"),
      new DemasiadoGrande("Cuerpo demasiado grande"),
      new NoSoportado("Content-Type no JSON"),
      new DemasiadosIntentos("Demasiados intentos"),
      new ErrorInterno("Inesperado"),
    ];
    for (const caso of casos) {
      const respuesta = respuestaDeError(caso);
      expect(respuesta.headers.get("content-type") ?? "").toContain("application/json");
      const cuerpo = await leerCuerpoError(respuesta);
      expect(cuerpo.error.length).toBeGreaterThan(0);
    }
  });

  it("ErrorDeValidacion con detalles también cumple ErrorHttpSchema", async () => {
    const error = new ErrorDeValidacion([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]);
    const respuesta = respuestaDeError(error);
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerCuerpoError(respuesta);
    expect(cuerpo.detalles).toEqual([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]);
  });
});

describe("A0 §8.12 · Content-Type no JSON → 415", () => {
  it("exigirJson rechaza text/plain", async () => {
    const peticion = peticionJson("hola", "text/plain");
    const error = await errorDe(() => {
      exigirJson(peticion);
    });
    const respuesta = respuestaDeError(error as NoSoportado);
    expect(respuesta.status).toBe(415);
  });

  it("exigirJson acepta application/json con charset", () => {
    const peticion = peticionJson('{"nombre":"Ana"}', "application/json; charset=utf-8");
    expect(() => exigirJson(peticion)).not.toThrow();
  });

  it("un cuerpo JSON sin cabecera content-type también es 415", async () => {
    const peticion = new Request("http://localhost/api/privada", {
      method: "POST",
      body: JSON.stringify({ nombre: "Ana" }),
    });
    peticion.headers.delete("content-type");
    const error = await errorDe(() => {
      exigirJson(peticion);
    });
    const respuesta = respuestaDeError(error as NoSoportado);
    expect(respuesta.status).toBe(415);
  });

  it("una ruta con manejar() responde 415 a text/plain", async () => {
    const ruta = manejar(async function controlador(peticion: Request): Promise<Response> {
      exigirJson(peticion);
      return Response.json({ ok: true });
    });
    const respuesta = await ruta(peticionJson("hola", "text/plain"));
    expect(respuesta.status).toBe(415);
  });
});

describe("A0 §6 · límite de cuerpo → 413 (borde)", () => {
  it("un Content-Length por encima de MAXIMO_CUERPO_BYTES lanza DemasiadoGrande", async () => {
    const peticion = new Request("http://localhost/api/privada", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAXIMO_CUERPO_BYTES + 1),
      },
      body: "{}",
    });
    const error = await errorDe(leerCuerpo(peticion));
    const respuesta = respuestaDeError(error as DemasiadoGrande);
    expect(respuesta.status).toBe(413);
  });

  it("un cuerpo real por encima del máximo también es 413", async () => {
    const relleno = "a".repeat(MAXIMO_CUERPO_BYTES + 10);
    const peticion = peticionJson(JSON.stringify({ relleno }));
    const error = await errorDe(leerCuerpo(peticion));
    const respuesta = respuestaDeError(error as DemasiadoGrande);
    expect(respuesta.status).toBe(413);
  });

  it("un cuerpo dentro del límite se lee sin error", async () => {
    const peticion = peticionJson(JSON.stringify({ nombre: "Ana" }));
    const texto = await leerCuerpo(peticion);
    expect(texto).toContain("Ana");
  });
});

describe("A0 §6 · lector de Authorization: Bearer", () => {
  it("extrae el token de 'Bearer <token>'", () => {
    const peticion = new Request("http://localhost/api/privada", {
      headers: { authorization: "Bearer token-valido" },
    });
    expect(leerBearer(peticion)).toBe("token-valido");
  });

  it("sin cabecera lanza 'Falta la sesión'", async () => {
    const peticion = new Request("http://localhost/api/privada");
    const error = await errorDe(() => {
      leerBearer(peticion);
    });
    expect(error.message).toBe("Falta la sesión");
    expect(respuestaDeError(error as NoAutenticado).status).toBe(401);
  });

  it("un token de MAXIMO_TOKEN + 1 caracteres es rechazado", async () => {
    const peticion = new Request("http://localhost/api/privada", {
      headers: { authorization: `Bearer ${"a".repeat(MAXIMO_TOKEN + 1)}` },
    });
    const error = await errorDe(() => {
      leerBearer(peticion);
    });
    expect(respuestaDeError(error as NoAutenticado).status).toBe(401);
    expect(MAXIMO_TOKEN).toBe(4096);
  });
});
