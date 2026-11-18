import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ErrorHttpSchema, type Login } from "@/shared/schema";
import { DemasiadosIntentos } from "@/shared/server/errors";

/**
 * Ruta `POST /api/auth/login` frente al límite de intentos (spec A6, R3, R7).
 *
 * Se prueba la ruta REAL (con `manejar` y la validación Zod de la frontera) y
 * se sustituye el contenedor con `vi.mock`: cero red, cero Firebase. Aquí se
 * comprueba la lectura de la IP por cabeceras y que el 429 no lleva detalles.
 * Las reglas del contador viven en `cuentas-login-limite.test.ts`.
 */

const CORREO = "ana@x.com";
const CONTRASENA = "contrasena-larga-123";
const MENSAJE_LIMITE = "Demasiados intentos; espera unos minutos";

type Contexto = {
  ip: string | null;
};

/** Servicio de cuentas con la única operación que usa esta ruta. */
type DobleCuentas = {
  iniciarSesion: Mock<(datos: Login, contexto?: Contexto) => Promise<object>>;
};

type EstadoContenedor = {
  cuentas: DobleCuentas;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    cuentas: {
      iniciarSesion: vi.fn<(datos: Login, contexto?: Contexto) => Promise<object>>(siempreFalla),
    },
  };
});

vi.mock("@/features/container", () => {
  return {
    servicios: {
      get cuentas() {
        return estado.cuentas;
      },
    },
  };
});

function servicioBase(): DobleCuentas {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    iniciarSesion: vi.fn<(datos: Login, contexto?: Contexto) => Promise<object>>(siempreFalla),
  };
}

function configurarServicio(servicio: DobleCuentas): void {
  estado.cuentas = servicio;
}

/** Cuerpo válido de login, serializado. */
function cuerpo(): string {
  return JSON.stringify({ email: CORREO, password: CONTRASENA });
}

/** Respuesta de cuenta mínima: la ruta no la inspecciona. */
const CUENTA = {
  token: "id-token",
  refreshToken: "refresh",
  expiraEnSeg: 3600,
  usuario: { id: "uid-ana", email: CORREO, rol: "usuario" },
};

/**
 * POST a la ruta con las cabeceras indicadas. `tipo` permite probar el 415 sin
 * cambiar el cuerpo.
 */
function peticion(cabeceras?: Record<string, string>, tipo = "application/json"): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": tipo, ...cabeceras },
    body: cuerpo(),
  });
}

type Handler = (peticion: Request) => Promise<Response>;

/** Se importa una sola vez para no duplicar `ErrorDeDominio` entre módulos. */
async function cargarLogin(): Promise<Handler> {
  const modulo = await import("../auth/login/route");
  return modulo.POST;
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

/** IP que la ruta entregó al servicio en la última llamada. */
function contextoDe(servicio: DobleCuentas): Contexto | undefined {
  return servicio.iniciarSesion.mock.calls[0]?.[1];
}

beforeEach(() => {
  configurarServicio(servicioBase());
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// R7: de dónde sale la IP
// ---------------------------------------------------------------------------

describe("A6 §8.8 · la ruta entrega al servicio la IP del proxy", () => {
  it("toma el último salto de x-forwarded-for (el que añade el proxy)", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(
      peticion({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" }),
    );

    expect(respuesta.status).toBe(200);
    expect(contextoDe(servicio)).toEqual({ ip: "150.172.238.178" });
  });

  it("quita el puerto de una IPv4 con ':puerto'", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-forwarded-for": "203.0.113.9:51234" }));

    expect(contextoDe(servicio)).toEqual({ ip: "203.0.113.9" });
  });

  it("quita corchetes y puerto de una IPv6", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-forwarded-for": "[2001:db8::1]:443" }));

    expect(contextoDe(servicio)).toEqual({ ip: "2001:db8::1" });
  });

  it("usa x-real-ip cuando falta x-forwarded-for", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-real-ip": "198.51.100.7" }));

    expect(contextoDe(servicio)).toEqual({ ip: "198.51.100.7" });
  });

  it("x-real-ip gana a x-forwarded-for (no se puede falsear la IP)", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "192.0.2.1" }));

    expect(contextoDe(servicio)).toEqual({ ip: "192.0.2.1" });
  });

  it("un x-real-ip que no es una IP se ignora y se usa x-forwarded-for", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "no-es-ip" }));

    expect(contextoDe(servicio)).toEqual({ ip: "198.51.100.7" });
  });

  it("sin cabeceras de proxy entrega { ip: null } y el login sigue", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(peticion());

    expect(respuesta.status).toBe(200);
    expect(contextoDe(servicio)).toEqual({ ip: null });
  });

  it.each([
    ["texto arbitrario", "abc"],
    ["puerto suelto", "1"],
    ["IPv4 fuera de rango", "999.1.1.1"],
    ["demasiado larga", "a".repeat(200)],
    ["vacía", "   "],
  ])("%s en x-forwarded-for → { ip: null } (modo degradado)", async (_caso, valor) => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(CUENTA);
    configurarServicio(servicio);
    const POST = await cargarLogin();

    await POST(peticion({ "x-forwarded-for": valor }));

    expect(contextoDe(servicio)).toEqual({ ip: null });
  });
});

// ---------------------------------------------------------------------------
// R3: el 429 sale de la ruta sin detalles
// ---------------------------------------------------------------------------

describe("A6 §8.9 · login bloqueado → 429 con el mensaje literal y sin detalles", () => {
  it("traduce DemasiadosIntentos a { error } y no expone nada más", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new DemasiadosIntentos(MENSAJE_LIMITE));
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(peticion({ "x-forwarded-for": "203.0.113.9" }));
    const error = await leerError(respuesta);

    expect(respuesta.status).toBe(429);
    expect(error).toEqual({ error: MENSAJE_LIMITE });
    expect(error.detalles).toBeUndefined();
  });

  it("la respuesta 429 no contiene el correo, la contraseña ni la IP", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new DemasiadosIntentos(MENSAJE_LIMITE));
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(peticion({ "x-forwarded-for": "203.0.113.9" }));
    const texto = await respuesta.text();

    expect(texto).not.toContain(CORREO);
    expect(texto).not.toContain(CONTRASENA);
    expect(texto).not.toContain("203.0.113.9");
  });
});

// ---------------------------------------------------------------------------
// Frontera: nada inválido llega al servicio
// ---------------------------------------------------------------------------

describe("A6 §8.10 · un cuerpo inválido no llega al límite", () => {
  it.each([
    ["sin password", JSON.stringify({ email: CORREO })],
    ["sin email", JSON.stringify({ password: CONTRASENA })],
    ["password corta", JSON.stringify({ email: CORREO, password: "corta" })],
    ["email inválido", JSON.stringify({ email: "no-es-correo", password: CONTRASENA })],
    ["cuerpo vacío", "{}"],
  ])("%s → 400 y el servicio no se llama", async (_caso, texto) => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: texto,
      }),
    );

    expect(respuesta.status).toBe(400);
    expect(servicio.iniciarSesion).not.toHaveBeenCalled();
  });

  it("Content-Type distinto de JSON → 415 sin llamar al servicio", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const POST = await cargarLogin();

    const respuesta = await POST(peticion({ "x-forwarded-for": "203.0.113.9" }, "text/plain"));

    expect(respuesta.status).toBe(415);
    expect(servicio.iniciarSesion).not.toHaveBeenCalled();
  });
});
