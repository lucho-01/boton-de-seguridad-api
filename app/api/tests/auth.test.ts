import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  ErrorHttpSchema,
  type RespuestaCuenta,
  RespuestaCuentaSchema,
  type RespuestaYo,
  RespuestaYoSchema,
  SesionSchema,
  type Sesion,
} from "@/shared/schema";
import {
  Conflicto,
  DemasiadosIntentos,
  ErrorInterno,
  NoAutenticado,
  NoAutorizado,
} from "@/shared/server/errors";

/**
 * Rutas HTTP de A1 (spec A1, §3, §5, §9): `registro`, `login`, `refresh`, `yo`.
 *
 * Se prueban las rutas REALES (con `manejar` y la validación Zod de la
 * frontera), pero el contenedor se sustituye por dobles con `vi.mock`: cero
 * red, cero Firebase, cero Firestore.
 */

const CORREO = "ana@x.com";
const CONTRASENA = "contrasena-larga-123";
const UID = "u1";

// ---------------------------------------------------------------------------
// Dobles del contenedor, reemplazables prueba a prueba.
// ---------------------------------------------------------------------------

/** Servicio de cuentas que delega en funciones programables por la prueba. */
/** Servicio de cuentas que delega en funciones programables por la prueba. */
type DobleServicio = {
  registrar: Mock<(datos: object) => Promise<object>>;
  iniciarSesion: Mock<(datos: object) => Promise<object>>;
  renovar: Mock<(datos: object) => Promise<object>>;
  yo: Mock<(sesion: Sesion) => Promise<object>>;
};

/** Verificador de token configurable: devuelve la sesión o lanza 401. */
type VerificadorDoble = {
  verificar: Mock<(token: string) => Promise<Sesion>>;
};

/** Estado compartido entre `vi.mock` (elevado) y las pruebas. Tipado explícito. */
type EstadoContenedor = {
  cuentas: DobleServicio;
  verificar: (token: string) => Promise<Sesion>;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    cuentas: {
      registrar: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
      iniciarSesion: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
      renovar: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
      yo: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
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

/** Programa el servicio de cuentas de la siguiente llamada. */
function configurarServicio(servicio: DobleServicio): void {
  estado.cuentas = servicio;
}

/** Programa el verificador de token de la siguiente llamada. */
function configurarVerificador(verificador: VerificadorDoble): void {
  estado.verificar = verificador.verificar;
}

/** Doble por defecto que siempre falla; cada prueba lo reprograma. */
function servicioBase(): DobleServicio {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    registrar: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
    iniciarSesion: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
    renovar: vi.fn<(datos: object) => Promise<object>>(siempreFalla),
    yo: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
  };
}

// ---------------------------------------------------------------------------
// Utilidades de petición y lectura.
// ---------------------------------------------------------------------------

function peticionJson(ruta: string, cuerpo: string, tipo = "application/json"): Request {
  return new Request(`http://localhost${ruta}`, {
    method: "POST",
    headers: { "content-type": tipo },
    body: cuerpo,
  });
}

function peticionGet(ruta: string, cabeceras?: Record<string, string>): Request {
  return new Request(`http://localhost${ruta}`, { method: "GET", headers: cabeceras });
}

type Handler = (peticion: Request) => Promise<Response>;

/**
 * Las rutas se importan una sola vez: `vi.resetModules()` no se usa para no
 * duplicar `ErrorDeDominio` (dos copias romperían el `instanceof` de `manejar`).
 * El contenedor simulado lee el servicio vigente en cada llamada.
 */
async function cargarRegistro(): Promise<Handler> {
  const modulo = await import("../auth/registro/route");
  return modulo.POST;
}

async function cargarLogin(): Promise<Handler> {
  const modulo = await import("../auth/login/route");
  return modulo.POST;
}

async function cargarRefresh(): Promise<Handler> {
  const modulo = await import("../auth/refresh/route");
  return modulo.POST;
}

async function cargarYo(): Promise<Handler> {
  const modulo = await import("../auth/yo/route");
  return modulo.GET;
}

async function leerRespuestaCuenta(respuesta: Response): Promise<RespuestaCuenta> {
  return RespuestaCuentaSchema.parse(await respuesta.json());
}

async function leerRespuestaYo(respuesta: Response): Promise<RespuestaYo> {
  return RespuestaYoSchema.parse(await respuesta.json());
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

/** Respuesta de cuenta ya validada; el usuario sale del token simulado. */
function cuentaDe(uid: string, email: string): RespuestaCuenta {
  return RespuestaCuentaSchema.parse({
    token: "id-token",
    refreshToken: "refresh-token",
    expiraEnSeg: 3600,
    usuario: { id: uid, email, rol: "usuario" },
  });
}

function sesionDe(uid: string, email: string): Sesion {
  return SesionSchema.parse({ uid, email, rol: "usuario" });
}

beforeEach(() => {
  configurarServicio(servicioBase());
  configurarVerificador({
    verificar: vi.fn<(token: string) => Promise<Sesion>>(() =>
      Promise.reject(new NoAutenticado("Sesión inválida o vencida")),
    ),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/auth/registro
// ---------------------------------------------------------------------------

describe("A1 §8.1 · POST /api/auth/registro válido → 201", () => {
  it("responde 201 con token, refreshToken, expiraEnSeg > 0 y usuario.rol 'usuario'", async () => {
    const servicio = servicioBase();
    const esperada = cuentaDe(UID, CORREO);
    servicio.registrar.mockResolvedValue(esperada);
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
    const cuerpo = await leerRespuestaCuenta(respuesta);
    expect(cuerpo.expiraEnSeg).toBeGreaterThan(0);
    expect(cuerpo.usuario.rol).toBe("usuario");
  });

  it("la respuesta valida con RespuestaCuentaSchema y usuario solo trae { id, email, rol }", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    const cuerpo = await leerRespuestaCuenta(respuesta);
    expect(Object.keys(cuerpo.usuario).sort()).toEqual(["email", "id", "rol"]);
    expect(cuerpo.usuario).not.toHaveProperty("perfil");
  });

  it("el servicio recibe el correo normalizado (trim + minúsculas, R1)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: "  Ana@X.com ", password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(servicio.registrar).toHaveBeenCalledTimes(1);
    const datos = servicio.registrar.mock.calls[0]?.[0];
    expect(datos).toMatchObject({ email: "ana@x.com", perfil: "persona" });
  });
});

describe("A1 §8.3 · POST /api/auth/registro con correo existente → 409", () => {
  it("traduce EMAIL_EXISTS a 409 'El correo ya está registrado'", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockRejectedValue(new Conflicto("El correo ya está registrado"));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(409);
    expect((await leerError(respuesta)).error).toBe("El correo ya está registrado");
  });
});

describe("A1 §8.4 · POST /api/auth/registro: longitud de contraseña (R2)", () => {
  it("7 caracteres → 400 con detalles[0].campo === 'password'", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: "1234567", perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.detalles?.[0]?.campo).toBe("password");
  });

  it("8 caracteres se acepta (borde inferior)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: "12345678", perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });

  it("128 caracteres se acepta (borde superior)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: "a".repeat(128), perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });

  it("129 caracteres se rechaza con detalles[0].campo === 'password'", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: "a".repeat(129), perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("password");
  });

  it("los 400 no llaman al servicio", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: "corta", perfil: "persona" }),
      ),
    );
    expect(servicio.registrar).not.toHaveBeenCalled();
  });
});

describe("A1 §8.5 · POST /api/auth/registro: el perfil es obligatorio (R3)", () => {
  it("sin perfil → 400 con detalles[0].campo === 'perfil'", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson("/api/auth/registro", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("perfil");
  });

  it("perfil 'otro' → 400", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "otro" }),
      ),
    );
    expect(respuesta.status).toBe(400);
  });

  it("perfil 'persona' → pasa la validación (201)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });

  it("perfil 'contacto' → pasa la validación (201)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "contacto" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });
});

describe("A1 §8 (extra) · POST /api/auth/registro: correo inválido y largo (R1)", () => {
  it("correo sin '@' → 400 con detalles[0].campo === 'email'", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: "sin-arroba", password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("email");
  });

  it("correo de 255 caracteres → 400 (máximo 254)", async () => {
    const POST = await cargarRegistro();
    const email255 = `${"a".repeat(249)}@x.com`;
    expect(email255.length).toBe(255);
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: email255, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(400);
  });

  it("correo de 254 caracteres se acepta (borde)", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const email254 = `${"a".repeat(248)}@x.com`;
    expect(email254.length).toBe(254);
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: email254, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });
});

describe("A1 §8.16 (extra) · POST /api/auth/registro: contenido y formato del cuerpo", () => {
  it("Content-Type text/plain → 415", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson("/api/auth/registro", "email=ana@x.com", "text/plain"),
    );
    expect(respuesta.status).toBe(415);
  });

  it("cuerpo vacío → 400", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(peticionJson("/api/auth/registro", ""));
    expect(respuesta.status).toBe(400);
  });

  it("JSON malformado → 400", async () => {
    const POST = await cargarRegistro();
    const respuesta = await POST(peticionJson("/api/auth/registro", "{no-json"));
    expect(respuesta.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe("A1 §8.6 · POST /api/auth/login: credenciales inválidas → mismo 401 (R6)", () => {
  it("contraseña incorrecta y correo inexistente dan el MISMO cuerpo 401", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new NoAutenticado("Correo o contraseña incorrectos"));
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Correo o contraseña incorrectos");
  });

  it("no revela el correo en el mensaje del 401", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new NoAutenticado("Correo o contraseña incorrectos"));
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(JSON.stringify(await leerError(respuesta))).not.toContain(CORREO);
  });
});

describe("A1 §8.7 · POST /api/auth/login correcto → 200", () => {
  it("devuelve 200 con tokens y usuario", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = await leerRespuestaCuenta(respuesta);
    expect(cuerpo.token.length).toBeGreaterThan(0);
    expect(cuerpo.usuario.id).toBe(UID);
    expect(cuerpo.usuario).not.toHaveProperty("perfil");
  });
});

describe("A1 §8.8 y §8.9 · POST /api/auth/login: cuenta deshabilitada y demasiados intentos", () => {
  it("USER_DISABLED → 403 'La cuenta está deshabilitada'", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new NoAutorizado("La cuenta está deshabilitada"));
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(403);
    expect((await leerError(respuesta)).error).toBe("La cuenta está deshabilitada");
  });

  it("TOO_MANY_ATTEMPTS_TRY_LATER → 429 con el mensaje de R8", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(
      new DemasiadosIntentos("Demasiados intentos; espera unos minutos"),
    );
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(429);
    expect((await leerError(respuesta)).error).toBe("Demasiados intentos; espera unos minutos");
  });
});

describe("A1 §8.15 · POST /api/auth/login: la contraseña nunca vuelve", () => {
  it("ni el 200 ni los 4xx contienen la contraseña", async () => {
    const servicioOk = servicioBase();
    servicioOk.iniciarSesion.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicioOk);
    const POST = await cargarLogin();
    const ok = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(await ok.clone().text()).not.toContain(CONTRASENA);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/refresh
// ---------------------------------------------------------------------------

describe("A1 §8.10 · POST /api/auth/refresh con token válido → 200 con tokens nuevos (R9)", () => {
  it("devuelve token y refreshToken nuevos y expiraEnSeg", async () => {
    const servicio = servicioBase();
    servicio.renovar.mockResolvedValue({
      token: "id-token-nuevo",
      refreshToken: "refresh-nuevo",
      expiraEnSeg: 3600,
    });
    configurarServicio(servicio);
    const POST = await cargarRefresh();
    const respuesta = await POST(
      peticionJson("/api/auth/refresh", JSON.stringify({ refreshToken: "refresh-viejo" })),
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({
      token: "id-token-nuevo",
      refreshToken: "refresh-nuevo",
      expiraEnSeg: 3600,
    });
  });

  it("pasa el refreshToken al servicio", async () => {
    const servicio = servicioBase();
    servicio.renovar.mockResolvedValue({ token: "t", refreshToken: "r", expiraEnSeg: 3600 });
    configurarServicio(servicio);
    const POST = await cargarRefresh();
    await POST(
      peticionJson("/api/auth/refresh", JSON.stringify({ refreshToken: "refresh-viejo" })),
    );
    expect(servicio.renovar).toHaveBeenCalledWith({ refreshToken: "refresh-viejo" });
  });
});

describe("A1 §8.11 · POST /api/auth/refresh: token inválido → 401; vacío → 400", () => {
  it("INVALID_REFRESH_TOKEN → 401", async () => {
    const servicio = servicioBase();
    servicio.renovar.mockRejectedValue(new NoAutenticado("Sesión inválida o vencida"));
    configurarServicio(servicio);
    const POST = await cargarRefresh();
    const respuesta = await POST(
      peticionJson("/api/auth/refresh", JSON.stringify({ refreshToken: "refresh-roto" })),
    );
    expect(respuesta.status).toBe(401);
  });

  it("refreshToken vacío → 400 sin llamar al servicio", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const POST = await cargarRefresh();
    const respuesta = await POST(
      peticionJson("/api/auth/refresh", JSON.stringify({ refreshToken: "" })),
    );
    expect(respuesta.status).toBe(400);
    expect(servicio.renovar).not.toHaveBeenCalled();
  });

  it("Content-Type text/plain → 415", async () => {
    const POST = await cargarRefresh();
    const respuesta = await POST(peticionJson("/api/auth/refresh", "refresh=v", "text/plain"));
    expect(respuesta.status).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/yo
// ---------------------------------------------------------------------------

describe("A1 §8.12 · GET /api/auth/yo con token válido → 200 { usuario: { id: uid, email, rol } }", () => {
  it("devuelve el usuario del token verificado", async () => {
    configurarVerificador({
      verificar: vi.fn().mockResolvedValue(sesionDe("u1", "u1@x.com")),
    });
    const servicio = servicioBase();
    servicio.yo.mockResolvedValue(
      RespuestaYoSchema.parse({ usuario: { id: "u1", email: "u1@x.com", rol: "usuario" } }),
    );
    configurarServicio(servicio);
    const GET = await cargarYo();
    const respuesta = await GET(
      peticionGet("/api/auth/yo", { authorization: "Bearer token-valido" }),
    );
    expect(respuesta.status).toBe(200);
    const cuerpo = await leerRespuestaYo(respuesta);
    expect(cuerpo.usuario).toEqual({ id: "u1", email: "u1@x.com", rol: "usuario" });
    expect(cuerpo.usuario).not.toHaveProperty("perfil");
  });

  it("el id sale del token verificado y NO del query ni del cuerpo", async () => {
    const verificar = vi.fn().mockResolvedValue(sesionDe("u1", "u1@x.com"));
    configurarVerificador({ verificar });
    const servicio = servicioBase();
    servicio.yo.mockResolvedValue(
      RespuestaYoSchema.parse({ usuario: { id: "u1", email: "u1@x.com", rol: "usuario" } }),
    );
    configurarServicio(servicio);
    const GET = await cargarYo();
    // Query con otro id: debe ignorarse.
    const respuesta = await GET(
      peticionGet("/api/auth/yo?id=u2&uid=u2", { authorization: "Bearer token-valido" }),
    );
    const cuerpo = await leerRespuestaYo(respuesta);
    expect(cuerpo.usuario.id).toBe("u1");
    expect(cuerpo.usuario.id).not.toBe("u2");
    // El servicio recibió la sesión del token, no el query.
    expect(servicio.yo).toHaveBeenCalledWith(expect.objectContaining({ uid: "u1" }));
  });
});

describe("A1 §8.13 · GET /api/auth/yo sin token o con token inválido → 401", () => {
  it("sin Authorization → 401 'Falta la sesión'", async () => {
    const GET = await cargarYo();
    const respuesta = await GET(peticionGet("/api/auth/yo"));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("Bearer inválido → 401 'Sesión inválida o vencida'", async () => {
    configurarVerificador({
      verificar: vi.fn().mockRejectedValue(new NoAutenticado("Sesión inválida o vencida")),
    });
    const GET = await cargarYo();
    const respuesta = await GET(
      peticionGet("/api/auth/yo", { authorization: "Bearer token-roto" }),
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Sesión inválida o vencida");
  });

  it("cabecera Basic → 401", async () => {
    const GET = await cargarYo();
    const respuesta = await GET(
      peticionGet("/api/auth/yo", { authorization: "Basic dXNlcjpwYXNz" }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("sin token no se consulta el servicio de cuentas", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarYo();
    await GET(peticionGet("/api/auth/yo"));
    expect(servicio.yo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transversales
// ---------------------------------------------------------------------------

describe("A1 §8.14 · un fallo inesperado del servicio → 500 'Error interno' sin detalles", () => {
  it("una excepción no de dominio en registro responde 500 opaco", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockRejectedValue(new Error("boom interno con stack"));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("boom interno");
  });

  it("ErrorInterno del servicio (Firestore caído) responde 500 sin detalles", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
  });
});

describe("A1 §8.14 (extendido) · registro: la verificación del token falla tras crear la cuenta → 500", () => {
  it("POST /api/auth/registro responde 500 { error: 'Error interno' } sin detalles ni correo ni contraseña", async () => {
    // El servicio (con rollback ya hecho) rechaza con ErrorInterno; la ruta lo
    // traduce a 500 opaco sin filtrar datos personales ni la contraseña.
    const servicio = servicioBase();
    servicio.registrar.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(500);
    const texto = await respuesta.clone().text();
    const cuerpo = ErrorHttpSchema.parse(JSON.parse(texto));
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    expect(texto).not.toContain(CORREO);
    expect(texto).not.toContain(CONTRASENA);
  });
});

describe("A1 §8.14 (extendido) · login: un fallo del verificador no intenta borrar la cuenta", () => {
  it("POST /api/auth/login con verificador caído → 500 opaco, sin rollback", async () => {
    // En login la ruta delega en `iniciarSesion`, que no crea ni borra cuentas.
    // El servicio real lanza ErrorInterno si el verificador no puede resolver
    // al usuario recién autenticado; la ruta responde 500 sin detalles.
    const servicio = servicioBase();
    servicio.iniciarSesion.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    // La ruta solo consulta `iniciarSesion`: nunca llama a `registrar`.
    expect(servicio.registrar).not.toHaveBeenCalled();
  });
});

describe("A1 §8.15 · ninguna respuesta expone la API key ni tokens de error", () => {
  it("el 500 de registro no contiene la API key simbólica", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockRejectedValue(new Error("fallo apiKey=clave-web-de-prueba"));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(JSON.stringify(await leerError(respuesta))).not.toContain("clave-web-de-prueba");
  });

  it("el 401 de refresh no repite el refreshToken recibido", async () => {
    const servicio = servicioBase();
    servicio.renovar.mockRejectedValue(new NoAutenticado("Sesión inválida o vencida"));
    configurarServicio(servicio);
    const POST = await cargarRefresh();
    const respuesta = await POST(
      peticionJson("/api/auth/refresh", JSON.stringify({ refreshToken: "refresh-secreto-xyz" })),
    );
    expect(JSON.stringify(await leerError(respuesta))).not.toContain("refresh-secreto-xyz");
  });
});

describe("A1 §5 · las rutas de registro/login/refresh son públicas (no exigen Bearer)", () => {
  it("registro responde 201 sin Authorization", async () => {
    const servicio = servicioBase();
    servicio.registrar.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarRegistro();
    const respuesta = await POST(
      peticionJson(
        "/api/auth/registro",
        JSON.stringify({ email: CORREO, password: CONTRASENA, perfil: "persona" }),
      ),
    );
    expect(respuesta.status).toBe(201);
  });

  it("login responde 200 sin Authorization", async () => {
    const servicio = servicioBase();
    servicio.iniciarSesion.mockResolvedValue(cuentaDe(UID, CORREO));
    configurarServicio(servicio);
    const POST = await cargarLogin();
    const respuesta = await POST(
      peticionJson("/api/auth/login", JSON.stringify({ email: CORREO, password: CONTRASENA })),
    );
    expect(respuesta.status).toBe(200);
  });
});
