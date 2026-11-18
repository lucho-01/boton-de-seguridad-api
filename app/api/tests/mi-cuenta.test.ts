import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ErrorHttpSchema, OkSchema, type Sesion, SesionSchema } from "@/shared/schema";
import { ErrorInterno, NoAutenticado } from "@/shared/server/errors";

/**
 * Ruta `DELETE /api/mi-cuenta` (spec A4, §3, §5, §6, §8): borrar mi cuenta y
 * todos mis datos.
 *
 * Se prueba la ruta REAL (con `manejar` y la validación Zod de la frontera),
 * pero el contenedor se sustituye por dobles con `vi.mock`: cero red, cero
 * Firebase y cero Firestore. Las reglas de negocio (orden Firestore → Auth,
 * `USER_NOT_FOUND` como éxito, idempotencia) están en
 * `app/features/accounts/tests/cuentas-service.test.ts`.
 */

const UID_A = "uid-ana";
const UID_B = "uid-beto";
const MENSAJE_CONFIRMAR = "Escribe BORRAR para confirmar";
const MAXIMO_CUERPO = 64 * 1024;

/** Servicio de cuentas con la única operación que usa esta ruta. */
type DobleCuentas = {
  borrarCuenta: Mock<(sesion: Sesion) => Promise<object>>;
};

/** Estado compartido entre `vi.mock` (elevado) y las pruebas. */
type EstadoContenedor = {
  cuentas: DobleCuentas;
  verificar: (token: string) => Promise<Sesion>;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    cuentas: {
      borrarCuenta: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
    },
    verificar: siempreFalla,
  };
});

vi.mock("@/features/container", () => {
  return {
    servicios: {
      get cuentas() {
        return estado.cuentas;
      },
    },
    verificadorDeToken: {
      verificar(token: string) {
        return estado.verificar(token);
      },
    },
  };
});

/** Doble por defecto que siempre falla; cada prueba lo reprograma. */
function servicioBase(): DobleCuentas {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    borrarCuenta: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
  };
}

function configurarServicio(servicio: DobleCuentas): void {
  estado.cuentas = servicio;
}

/** Verificador que resuelve siempre a la sesión indicada. */
function verificarSiempre(uid: string): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.resolve(SesionSchema.parse({ uid, rol: "usuario" })),
  );
}

/** Verificador que rechaza el token, como Firebase con uno vencido. */
function verificarNunca(): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.reject(new NoAutenticado("Sesión inválida o vencida")),
  );
}

// ---------------------------------------------------------------------------
// Utilidades de petición y lectura.
// ---------------------------------------------------------------------------

const BEARER = { authorization: "Bearer token-valido" };

/** DELETE con `Content-Type: application/json` (aunque el cuerpo falle). */
function peticionJson(cuerpo: string, cabeceras?: Record<string, string>): Request {
  return new Request("http://localhost/api/mi-cuenta", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...cabeceras },
    body: cuerpo,
  });
}

/** DELETE sin `Content-Type` JSON (o con el que se indique). */
function peticionConTipo(
  tipo: string,
  cuerpo: string,
  cabeceras?: Record<string, string>,
): Request {
  return new Request("http://localhost/api/mi-cuenta", {
    method: "DELETE",
    headers: { "content-type": tipo, ...cabeceras },
    body: cuerpo,
  });
}

type Handler = (peticion: Request) => Promise<Response>;

/** Importa el módulo una sola vez para no duplicar `ErrorDeDominio`. */
async function cargarBorrar(): Promise<Handler> {
  const modulo = await import("../mi-cuenta/route");
  return modulo.DELETE;
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

function confirmacion(): string {
  return JSON.stringify({ confirmar: "BORRAR" });
}

beforeEach(() => {
  configurarServicio(servicioBase());
  verificarNunca();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Camino feliz
// ---------------------------------------------------------------------------

describe("A4 §8.1 · DELETE con { confirmar: 'BORRAR' } y Bearer → 200 { ok: true }", () => {
  it("responde 200 con OkSchema y llama al servicio una vez con el uid del token", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrarCuenta.mockResolvedValue({ ok: true });
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion(), BEARER));

    expect(respuesta.status).toBe(200);
    expect(OkSchema.parse(await respuesta.json())).toEqual({ ok: true });
    expect(servicio.borrarCuenta).toHaveBeenCalledTimes(1);
    expect(servicio.borrarCuenta.mock.calls[0]?.[0]).toMatchObject({ uid: UID_A });
  });

  it("la respuesta no contiene correo, uid ni tokens (R7)", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrarCuenta.mockResolvedValue({ ok: true });
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion(), BEARER));
    const texto = await respuesta.text();

    expect(texto).not.toContain(UID_A);
    expect(texto).not.toContain("token-valido");
  });
});

// ---------------------------------------------------------------------------
// Confirmación (R1)
// ---------------------------------------------------------------------------

describe("A4 §8.2 · confirmación inválida → 400 con campo 'confirmar'", () => {
  it.each([
    ["cuerpo vacío {}", "{}"],
    ["literal en minúsculas", JSON.stringify({ confirmar: "borrar" })],
    ["literal con espacios", JSON.stringify({ confirmar: " BORRAR " })],
    ["literal vacío", JSON.stringify({ confirmar: "" })],
    ["confirmar como booleano", JSON.stringify({ confirmar: true })],
    ["sin confirmar pero con uid", JSON.stringify({ uid: UID_B })],
  ])("%s → 400, detalles[0].campo === 'confirmar' y no se borra", async (_caso, cuerpo) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(cuerpo, BEARER));

    expect(respuesta.status).toBe(400);
    const error = await leerError(respuesta);
    expect(error.detalles?.[0]?.campo).toBe("confirmar");
    expect(error.detalles?.[0]?.mensaje).toBe(MENSAJE_CONFIRMAR);
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });

  it("un cuerpo vacío (sin bytes) → 400 con el detalle de confirmar", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson("", BEARER));

    expect(respuesta.status).toBe(400);
    const error = await leerError(respuesta);
    expect(error.detalles?.[0]?.campo).toBe("confirmar");
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Frontera HTTP: 415 y 413
// ---------------------------------------------------------------------------

describe("A4 §8.3 · Content-Type y tamaño del cuerpo", () => {
  it("Content-Type text/plain → 415 y no se borra", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionConTipo("text/plain", confirmacion(), BEARER));

    expect(respuesta.status).toBe(415);
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });

  it("sin Content-Type → 415", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const peticion = new Request("http://localhost/api/mi-cuenta", {
      method: "DELETE",
      headers: { ...BEARER },
      body: confirmacion(),
    });
    const respuesta = await DELETE(peticion);

    expect(respuesta.status).toBe(415);
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });

  it("cuerpo mayor de 64 KB → 413 y no se borra", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const enorme = JSON.stringify({
      confirmar: "BORRAR",
      relleno: "x".repeat(MAXIMO_CUERPO + 1024),
    });

    const respuesta = await DELETE(peticionJson(enorme, BEARER));

    expect(respuesta.status).toBe(413);
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Autorización (§5, criterio 4)
// ---------------------------------------------------------------------------

describe("A4 §8.4 · sin token o token inválido → 401 y no se borra nada", () => {
  it("sin Authorization → 401 'Falta la sesión'", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion()));

    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });

  it("Bearer inválido o vencido → 401 'Sesión inválida o vencida'", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion(), BEARER));

    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Sesión inválida o vencida");
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });

  it("cabecera Basic → 401", async () => {
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(
      peticionJson(confirmacion(), { authorization: "Basic dXNlcjpwYXNz" }),
    );

    expect(respuesta.status).toBe(401);
  });

  it("sin token, el cuerpo inválido ni siquiera se evalúa: 401 y no 400", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(JSON.stringify({ confirmar: "NO" })));

    expect(respuesta.status).toBe(401);
    expect(servicio.borrarCuenta).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// El cuerpo no elige a quién borrar (R2, criterio 10)
// ---------------------------------------------------------------------------

describe("A4 §8.10 · el uid borrado es el del token, no el del cuerpo", () => {
  it("un uid distinto en el cuerpo se ignora: borra el de la sesión", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrarCuenta.mockResolvedValue({ ok: true });
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(
      peticionJson(JSON.stringify({ confirmar: "BORRAR", uid: UID_B }), BEARER),
    );

    expect(respuesta.status).toBe(200);
    expect(servicio.borrarCuenta.mock.calls[0]?.[0]).toMatchObject({ uid: UID_A });
    expect(JSON.stringify(servicio.borrarCuenta.mock.calls[0]?.[0])).not.toContain(UID_B);
  });
});

// ---------------------------------------------------------------------------
// Fallos del servicio (R6)
// ---------------------------------------------------------------------------

describe("A4 §8.5 y §8.6 · fallo al borrar → 500 opaco", () => {
  it("ErrorInterno del servicio → 500 'Error interno' sin detalles", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrarCuenta.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion(), BEARER));

    expect(respuesta.status).toBe(500);
    const error = await leerError(respuesta);
    expect(error.error).toBe("Error interno");
    expect(error.detalles).toBeUndefined();
  });

  it("un error inesperado del servicio → 500 sin stack ni mensaje interno", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrarCuenta.mockRejectedValue(new Error("fallo con datos de ana@x.com"));
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();

    const respuesta = await DELETE(peticionJson(confirmacion(), BEARER));

    expect(respuesta.status).toBe(500);
    const texto = await respuesta.text();
    expect(texto).not.toContain("fallo con datos");
    expect(texto).not.toContain("ana@x.com");
    const error = ErrorHttpSchema.parse(JSON.parse(texto));
    expect(error.error).toBe("Error interno");
    expect(error.detalles).toBeUndefined();
  });
});
