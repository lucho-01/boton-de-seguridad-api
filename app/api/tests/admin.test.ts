import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  type EstadoAdmin,
  ErrorHttpSchema,
  EstadoAdminSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { ErrorInterno, NoAutenticado, NoAutorizado } from "@/shared/server/errors";

/**
 * Ruta `GET /api/admin/estado` (spec A5, §3, §5, §6, §8 criterios 1–6).
 *
 * Se prueba la ruta REAL (con `manejar` y la lectura del Bearer), pero el
 * contenedor se sustituye por dobles con `vi.mock`: cero red, cero Firebase y
 * cero Firestore. Las reglas del servicio (403 sin consultar el repositorio,
 * validación de totales) están en
 * `app/features/accounts/tests/admin-service.test.ts`.
 */

const UID_ADMIN = "uid-admin";
const UID_ANA = "uid-ana";
const CORREO = "ana@x.com";
const TELEFONO = "3001234567";
const TOKEN = "token-valido";

const TOTALES: EstadoAdmin = { cuentas: 3, contactos: 12, alertas: 40 };

/** Servicio de administración con la única operación que usa esta ruta. */
type DobleAdmin = {
  estado: Mock<(sesion: Sesion) => Promise<object>>;
};

/** Estado compartido entre `vi.mock` (elevado) y las pruebas. */
type EstadoContenedor = {
  admin: DobleAdmin;
  verificar: (token: string) => Promise<Sesion>;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    admin: {
      estado: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
    },
    verificar: siempreFalla,
  };
});

vi.mock("@/features/container", () => {
  return {
    servicios: {
      get admin() {
        return estado.admin;
      },
    },
    get servicioAdmin() {
      return estado.admin;
    },
    verificadorDeToken: {
      verificar(token: string) {
        return estado.verificar(token);
      },
    },
  };
});

/** Doble por defecto que siempre falla; cada prueba lo reprograma. */
function servicioBase(): DobleAdmin {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    estado: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
  };
}

function configurarServicio(servicio: DobleAdmin): void {
  estado.admin = servicio;
}

/** Verificador que resuelve siempre a la sesión indicada. */
function verificarSiempre(uid: string, rol: Sesion["rol"]): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.resolve(SesionSchema.parse({ uid, email: CORREO, rol })),
  );
}

/** Verificador que rechaza el token, como Firebase con uno vencido. */
function verificarNunca(): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.reject(new NoAutenticado("Sesión inválida o vencida")),
  );
}

const BEARER = { authorization: "Bearer token-valido" };

function peticionGet(ruta: string, cabeceras?: Record<string, string>): Request {
  return new Request(`http://localhost${ruta}`, { method: "GET", headers: cabeceras });
}

type Handler = (peticion: Request) => Promise<Response>;

async function cargarEstado(): Promise<Handler> {
  const modulo = await import("../admin/estado/route");
  return modulo.GET;
}

async function leerEstado(respuesta: Response): Promise<EstadoAdmin> {
  return EstadoAdminSchema.parse(await respuesta.json());
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

beforeEach(() => {
  configurarServicio(servicioBase());
  verificarNunca();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Camino feliz (criterio 1)
// ---------------------------------------------------------------------------

describe("A5 §8.1 · GET con token 'admin' → 200 con los totales agregados", () => {
  it("responde 200, valida con EstadoAdminSchema y llama al servicio una vez con la sesión", async () => {
    verificarSiempre(UID_ADMIN, "admin");
    const servicio = servicioBase();
    servicio.estado.mockResolvedValue(TOTALES);
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(200);
    expect(await leerEstado(respuesta)).toEqual(TOTALES);
    expect(servicio.estado).toHaveBeenCalledTimes(1);
    expect(servicio.estado.mock.calls[0]?.[0]).toMatchObject({ uid: UID_ADMIN, rol: "admin" });
  });

  it("acepta totales en cero (sistema vacío) → 200", async () => {
    verificarSiempre(UID_ADMIN, "admin");
    const servicio = servicioBase();
    servicio.estado.mockResolvedValue({ cuentas: 0, contactos: 0, alertas: 0 });
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(200);
    expect(await leerEstado(respuesta)).toEqual({ cuentas: 0, contactos: 0, alertas: 0 });
  });

  it("la respuesta trae solo cuentas, contactos y alertas: sin correos, uid, teléfonos ni coordenadas", async () => {
    verificarSiempre(UID_ADMIN, "admin");
    const servicio = servicioBase();
    servicio.estado.mockResolvedValue(TOTALES);
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));
    const texto = await respuesta.text();
    const cuerpo = EstadoAdminSchema.parse(JSON.parse(texto));

    expect(Object.keys(cuerpo).sort()).toEqual(["alertas", "contactos", "cuentas"]);
    expect(texto).not.toContain(CORREO);
    expect(texto).not.toContain(UID_ANA);
    expect(texto).not.toContain(UID_ADMIN);
    expect(texto).not.toContain(TELEFONO);
    expect(texto).not.toContain("lat");
    expect(texto).not.toContain("lng");
    expect(texto).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Autorización (criterios 2 y 3)
// ---------------------------------------------------------------------------

describe("A5 §8.2 · token 'usuario' o sin claim → 403", () => {
  it("rol 'usuario' → 403 con el mensaje por defecto de NoAutorizado", async () => {
    verificarSiempre(UID_ANA, "usuario");
    const servicio = servicioBase();
    servicio.estado.mockRejectedValue(new NoAutorizado());
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(403);
    const error = await leerError(respuesta);
    expect(error.error).toBe("No tienes permiso para esta operación");
    expect(error.detalles).toBeUndefined();
  });

  it("token sin claim (A0 lo resuelve como 'usuario') → 403", async () => {
    verificarSiempre(UID_ANA, "usuario");
    const servicio = servicioBase();
    servicio.estado.mockRejectedValue(new NoAutorizado());
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(403);
    expect((await leerError(respuesta)).error).toBe("No tienes permiso para esta operación");
  });

  it("?rol=admin en la URL no eleva a un usuario: sigue siendo 403", async () => {
    verificarSiempre(UID_ANA, "usuario");
    const servicio = servicioBase();
    servicio.estado.mockRejectedValue(new NoAutorizado());
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(
      peticionGet("/api/admin/estado?rol=admin", {
        ...BEARER,
        "x-rol": "admin",
      }),
    );

    expect(respuesta.status).toBe(403);
    expect((await leerError(respuesta)).error).toBe("No tienes permiso para esta operación");
  });
});

describe("A5 §8.3 · sin token o token inválido → 401", () => {
  it("sin Authorization → 401 'Falta la sesión' y no se llama al servicio", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado"));

    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
    expect(servicio.estado).not.toHaveBeenCalled();
  });

  it("Bearer inválido o vencido → 401 'Sesión inválida o vencida'", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Sesión inválida o vencida");
    expect(servicio.estado).not.toHaveBeenCalled();
  });

  it("cabecera Basic → 401", async () => {
    const GET = await cargarEstado();

    const respuesta = await GET(
      peticionGet("/api/admin/estado", { authorization: "Basic dXNlcjpwYXNz" }),
    );

    expect(respuesta.status).toBe(401);
  });

  it("el 401 tiene prioridad: sin token no se evalúa el rol del servicio", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado?rol=admin"));

    expect(respuesta.status).toBe(401);
    expect(servicio.estado).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Fallos del servicio (criterio 5)
// ---------------------------------------------------------------------------

describe("A5 §8.5 · fallo al contar → 500 'Error interno' sin detalles", () => {
  it("ErrorInterno del servicio → 500 opaco", async () => {
    verificarSiempre(UID_ADMIN, "admin");
    const servicio = servicioBase();
    servicio.estado.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));

    expect(respuesta.status).toBe(500);
    const error = await leerError(respuesta);
    expect(error.error).toBe("Error interno");
    expect(error.detalles).toBeUndefined();
  });

  it("un error inesperado → 500 opaco sin stack ni mensaje interno", async () => {
    verificarSiempre(UID_ADMIN, "admin");
    const servicio = servicioBase();
    servicio.estado.mockRejectedValue(new Error("fallo con datos de ana@x.com"));
    configurarServicio(servicio);
    const GET = await cargarEstado();

    const respuesta = await GET(peticionGet("/api/admin/estado", BEARER));
    const texto = await respuesta.text();

    expect(respuesta.status).toBe(500);
    expect(texto).not.toContain("fallo con datos");
    expect(texto).not.toContain(CORREO);
    const error = ErrorHttpSchema.parse(JSON.parse(texto));
    expect(error.error).toBe("Error interno");
    expect(error.detalles).toBeUndefined();
  });
});
