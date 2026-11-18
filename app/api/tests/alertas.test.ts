import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  type Alerta,
  AlertaSchema,
  ErrorHttpSchema,
  type ResumenAlertas,
  ResumenAlertasSchema,
  type RespuestaAlertas,
  RespuestaAlertasSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import {
  ErrorDeValidacion,
  ErrorInterno,
  NoAutenticado,
  NoEncontrado,
} from "@/shared/server/errors";

/**
 * Rutas HTTP de A3 (spec A3, §3, §5, §6, §8): `GET /api/alertas`,
 * `PUT /api/alertas/<id>`, `DELETE /api/alertas/<id>` y
 * `GET /api/alertas/resumen`.
 *
 * Se prueban las rutas REALES (con `manejar` y la validación Zod de la
 * frontera), pero el contenedor se sustituye por dobles con `vi.mock`: cero
 * red, cero Firebase, cero Firestore.
 *
 * Aquí viven las reglas PURO-FRONTERA: 401 en las cuatro rutas, 400 de campos
 * del contrato (`estado`, `bateria_pct`, `creada_en` en otro huso),
 * 415 y 404 por id no UUID. Las reglas de negocio (ubicación todo-o-nada, hora
 * futura, idempotencia, resumen) están en
 * `app/features/alerts/tests/alertas-service.test.ts`.
 */

const ID_ANA = "11111111-1111-4111-8111-111111111111";
const UID_A = "uid-ana";
const UID_B = "uid-beto";

/** Servicio de alertas que delega en funciones programables por la prueba. */
type DobleServicio = {
  listar: Mock<(sesion: Sesion, since?: string) => Promise<object>>;
  guardar: Mock<(sesion: Sesion, id: string, datos: object) => Promise<object>>;
  borrar: Mock<(sesion: Sesion, id: string) => Promise<object>>;
  resumen: Mock<(sesion: Sesion) => Promise<object>>;
};

/** Estado compartido entre `vi.mock` (elevado) y las pruebas. */
type EstadoContenedor = {
  alertas: DobleServicio;
  verificar: (token: string) => Promise<Sesion>;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    alertas: {
      listar: vi.fn<(sesion: Sesion, since?: string) => Promise<object>>(siempreFalla),
      guardar: vi.fn<(sesion: Sesion, id: string, datos: object) => Promise<object>>(siempreFalla),
      borrar: vi.fn<(sesion: Sesion, id: string) => Promise<object>>(siempreFalla),
      resumen: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
    },
    verificar: siempreFalla,
  };
});

vi.mock("@/features/container", () => {
  return {
    servicios: {
      get alertas() {
        return estado.alertas;
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
function servicioBase(): DobleServicio {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    listar: vi.fn<(sesion: Sesion, since?: string) => Promise<object>>(siempreFalla),
    guardar: vi.fn<(sesion: Sesion, id: string, datos: object) => Promise<object>>(siempreFalla),
    borrar: vi.fn<(sesion: Sesion, id: string) => Promise<object>>(siempreFalla),
    resumen: vi.fn<(sesion: Sesion) => Promise<object>>(siempreFalla),
  };
}

/** Programa el servicio de alertas de la siguiente llamada. */
function configurarServicio(servicio: DobleServicio): void {
  estado.alertas = servicio;
}

/** Verificador que resuelve siempre a la sesión indicada. */
function verificarSiempre(uid: string): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.resolve(SesionSchema.parse({ uid, rol: "usuario" })),
  );
}

// ---------------------------------------------------------------------------
// Utilidades de petición y lectura.
// ---------------------------------------------------------------------------

const BEARER = { authorization: "Bearer token-valido" };

function peticionGet(ruta: string, cabeceras?: Record<string, string>): Request {
  return new Request(`http://localhost${ruta}`, { method: "GET", headers: cabeceras });
}

function peticionPut(ruta: string, cuerpo: string, cabeceras?: Record<string, string>): Request {
  const tipo = "application/json";
  return new Request(`http://localhost${ruta}`, {
    method: "PUT",
    headers: { "content-type": tipo, ...cabeceras },
    body: cuerpo,
  });
}

function peticionDelete(ruta: string, cabeceras?: Record<string, string>): Request {
  return new Request(`http://localhost${ruta}`, { method: "DELETE", headers: cabeceras });
}

type Handler = (peticion: Request) => Promise<Response>;

/** Firma real de un handler dinámico de Next: `(req, { params })`. */
type HandlerConId = (peticion: Request, contexto: ContextoRuta) => Promise<Response>;

type ContextoRuta = { params: Promise<{ id: string }> };

/** Importa cada módulo una sola vez para no duplicar `ErrorDeDominio`. */
async function cargarListar(): Promise<Handler> {
  const modulo = await import("../alertas/route");
  return modulo.GET;
}

async function cargarGuardar(): Promise<HandlerConId> {
  const modulo = await import("../alertas/[id]/route");
  return modulo.PUT;
}

async function cargarBorrar(): Promise<HandlerConId> {
  const modulo = await import("../alertas/[id]/route");
  return modulo.DELETE;
}

async function cargarResumen(): Promise<Handler> {
  const modulo = await import("../alertas/resumen/route");
  return modulo.GET;
}

/** Adapta el handler de `[id]` a la firma `(Request, contexto)` de Next. */
async function ejecutarConId(
  handler: HandlerConId,
  peticion: Request,
  id: string,
): Promise<Response> {
  const contexto: ContextoRuta = { params: Promise.resolve({ id }) };
  return handler(peticion, contexto);
}

async function leerAlertas(respuesta: Response): Promise<RespuestaAlertas> {
  return RespuestaAlertasSchema.parse(await respuesta.json());
}

async function leerAlerta(respuesta: Response): Promise<Alerta> {
  return AlertaSchema.parse(await respuesta.json());
}

async function leerResumen(respuesta: Response): Promise<ResumenAlertas> {
  return ResumenAlertasSchema.parse(await respuesta.json());
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

/** Documento del cable que devolvería un PUT correcto. */
function documentoDe(id: string, instante = "2026-11-14T08:00:00.000Z"): Alerta {
  return AlertaSchema.parse({
    id,
    lat: 4.711,
    lng: -74.0721,
    precision_m: 12.5,
    bateria_pct: 76,
    estado: "mensaje_preparado",
    creada_en: "2026-11-14T03:22:00.000Z",
    created_at: instante,
    updated_at: instante,
    deleted_at: null,
  });
}

function cuerpoValido(parcial: object = {}): string {
  return JSON.stringify({
    lat: 4.711,
    lng: -74.0721,
    precision_m: 12.5,
    bateria_pct: 76,
    estado: "mensaje_preparado",
    creada_en: "2026-11-14T03:22:00.000Z",
    ...parcial,
  });
}

beforeEach(() => {
  configurarServicio(servicioBase());
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.reject(new NoAutenticado("Sesión inválida o vencida")),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// PUT /api/alertas/<id>
// ---------------------------------------------------------------------------

describe("A3 §8.1 · PUT válido → 200 con el documento guardado", () => {
  it("responde 200 y el cuerpo valida con AlertaSchema (created_at === updated_at)", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    const guardado = await leerAlerta(respuesta);
    expect(guardado.id).toBe(ID_ANA);
    expect(guardado.deleted_at).toBeNull();
    expect(guardado.created_at).toBe(guardado.updated_at);
  });

  it("el servicio recibe la sesión del token y el id de la URL", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    await ejecutarConId(PUT, peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido(), BEARER), ID_ANA);
    expect(servicio.guardar).toHaveBeenCalledTimes(1);
    expect(servicio.guardar.mock.calls[0]?.[0]).toMatchObject({ uid: UID_A });
    expect(servicio.guardar.mock.calls[0]?.[1]).toBe(ID_ANA);
  });
});

describe("A3 §8.2 · PUT con ubicación nula → 200 con lat/lng/precision_m null", () => {
  it("pasa los tres campos en null y devuelve 200", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(
      AlertaSchema.parse({ ...documentoDe(ID_ANA), lat: null, lng: null, precision_m: null }),
    );
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(
        `/api/alertas/${ID_ANA}`,
        cuerpoValido({ lat: null, lng: null, precision_m: null }),
        BEARER,
      ),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    const guardado = await leerAlerta(respuesta);
    expect(guardado.lat).toBeNull();
    expect(guardado.lng).toBeNull();
    expect(guardado.precision_m).toBeNull();
  });
});

describe("A3 §8.3 · PUT con estado 'otro' → 400 con campo 'estado'", () => {
  it("responde 400, detalles[0].campo === 'estado' y no llama al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido({ estado: "otro" }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.detalles?.[0]?.campo).toBe("estado");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it.each(["cancelada", "mensaje_preparado"])("estado '%s' se acepta → 200", async (valor) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido({ estado: valor }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    expect(servicio.guardar.mock.calls[0]?.[2]).toMatchObject({ estado: valor });
  });
});

describe("A3 §8.4 y §8.5 · PUT con coordenadas incoherentes o fuera de rango → 400", () => {
  it.each([
    ["lat fuera de rango 90.1", { lat: 90.1 }],
    ["lat fuera de rango -90.1", { lat: -90.1 }],
    ["lng fuera de rango 180.1", { lng: 180.1 }],
    ["lng fuera de rango -180.1", { lng: -180.1 }],
    ["precision_m negativa", { precision_m: -1 }],
    ["precision_m por encima de 100 000", { precision_m: 100_001 }],
  ])("%s → 400 con detalle de coordenadas", async (_caso, parcial) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido(parcial), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerError(respuesta);
    const campos = (cuerpo.detalles ?? []).map((detalle) => detalle.campo);
    const esCoordenada = campos.some(
      (campo) => campo === "lat" || campo === "lng" || campo === "precision_m",
    );
    expect(esCoordenada).toBe(true);
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it("solo lat sin lng ni precision_m pasa la frontera; el 400 todo-o-nada es del servicio", async () => {
    // R2 (todo o nada) vive en el servicio, que es quien traduce la parcial a
    // 400 con el detalle de coordenadas (ver prueba de servicio §8.4). La
    // frontera acepta la parcial, así que la ruta llama al servicio; su
    // `ErrorDeValidacion` se traduce a 400 conservando `detalles`.
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(
      new ErrorDeValidacion([
        { campo: "lng", mensaje: "Coordenadas incompletas o fuera de rango" },
      ]),
    );
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(
        `/api/alertas/${ID_ANA}`,
        cuerpoValido({ lat: 4.711, lng: null, precision_m: null }),
        BEARER,
      ),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("lng");
    expect(servicio.guardar).toHaveBeenCalledTimes(1);
  });
});

describe("A3 §8.6 · PUT con bateria_pct inválido → 400 con campo 'bateria_pct'", () => {
  it.each([
    ["101", 101],
    ["no entero 12.5", 12.5],
    ["negativo -1", -1],
  ])("bateria_pct %s → 400 y detalles[0].campo === 'bateria_pct'", async (_caso, valor) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido({ bateria_pct: valor }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("bateria_pct");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it.each([0, 100, null])("bateria_pct %s → 200 (borde)", async (valor) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(
      AlertaSchema.parse({ ...documentoDe(ID_ANA), bateria_pct: valor }),
    );
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido({ bateria_pct: valor }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
  });
});

describe("A3 §8.13 · PUT con creada_en en otro huso (-05:00) → 400", () => {
  it("rechaza la fecha con zona y campo 'creada_en' sin llamar al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(
        `/api/alertas/${ID_ANA}`,
        cuerpoValido({ creada_en: "2026-11-14T03:22:00-05:00" }),
        BEARER,
      ),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("creada_en");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it.each([
    ["sin Z", "2026-11-14T03:22:00"],
    ["solo la fecha", "2026-11-14"],
    ["con +00:00", "2026-11-14T03:22:00+00:00"],
  ])("creada_en %s → 400 con campo 'creada_en'", async (_caso, valor) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido({ creada_en: valor }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("creada_en");
  });
});

describe("A3 R4 · el rechazo de creada_en por año 0000 no rompe GET /resumen", () => {
  it("PUT con creada_en 0000 → 400 (no 200) y el resumen sigue respondiendo 200", async () => {
    verificarSiempre(UID_A);
    // El PUT con `0000` lo rechaza el servicio con 400 (campo `creada_en`).
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(
      new ErrorDeValidacion([
        { campo: "creada_en", mensaje: "La hora de la alerta es demasiado antigua" },
      ]),
    );
    servicio.resumen.mockResolvedValue({
      meses: [{ mes: "2026-11", total: 2 }],
      total: 2,
    });
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const rechazo = await ejecutarConId(
      PUT,
      peticionPut(
        `/api/alertas/${ID_ANA}`,
        cuerpoValido({ creada_en: "0000-01-01T00:00:00.000Z" }),
        BEARER,
      ),
      ID_ANA,
    );
    expect(rechazo.status).toBe(400);
    const error = await leerError(rechazo);
    expect(error.detalles?.[0]?.campo).toBe("creada_en");
    // El resumen sigue devolviendo 200 con los meses válidos (no 500).
    const GET = await cargarResumen();
    const resumen = await GET(peticionGet("/api/alertas/resumen", BEARER));
    expect(resumen.status).toBe(200);
    const cuerpo = await leerResumen(resumen);
    expect(cuerpo.meses).toEqual([{ mes: "2026-11", total: 2 }]);
    expect(cuerpo.total).toBe(2);
  });
});

describe("A3 §8.7 · PUT traduce a 400 el rechazo de hora futura del servicio", () => {
  it("un ErrorDeValidacion del servicio → 400 con el mensaje literal de hora futura", async () => {
    // El servicio comprueba la ventana de ±5 min con el reloj inyectado y lanza
    // `ErrorDeValidacion`; la ruta lo traduce conservando `detalles`. La prueba
    // de negocio (6 min → 400, 4 min → 200) está en el test de servicio.
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(
      new ErrorDeValidacion(
        [{ campo: "creada_en", mensaje: "La hora de la alerta no puede ser futura" }],
        "La hora de la alerta no puede ser futura",
      ),
    );
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    const cuerpo = await leerError(respuesta);
    const detalle = (cuerpo.detalles ?? []).find((item) => item.campo === "creada_en");
    expect(detalle?.mensaje).toBe("La hora de la alerta no puede ser futura");
  });
});

describe("A3 §3 y §6 · PUT rechaza id no UUID y cuerpos no JSON", () => {
  it("id que no es UUID en la URL → 404 (ruta inexistente)", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut("/api/alertas/no-es-uuid", cuerpoValido(), BEARER),
      "no-es-uuid",
    );
    expect(respuesta.status).toBe(404);
    expect(servicio.guardar).not.toHaveBeenCalled();
  });

  it("Content-Type text/plain → 415", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      new Request(`http://localhost/api/alertas/${ID_ANA}`, {
        method: "PUT",
        headers: { "content-type": "text/plain", ...BEARER },
        body: cuerpoValido(),
      }),
      ID_ANA,
    );
    expect(respuesta.status).toBe(415);
  });

  it("cuerpo vacío → 400", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, "", BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
  });

  it("JSON malformado → 400", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, "{no-json", BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/alertas/<id>
// ---------------------------------------------------------------------------

describe("A3 §8.9 · DELETE lógico y su repetición", () => {
  it("DELETE de un existente → 200 { ok: true }", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrar.mockResolvedValue({ ok: true });
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/alertas/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
  });

  it("segundo DELETE → 404 'Alerta no encontrada'", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrar.mockRejectedValue(new NoEncontrado("Alerta no encontrada"));
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/alertas/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(404);
    expect((await leerError(respuesta)).error).toBe("Alerta no encontrada");
  });

  it("id que no es UUID → 404 sin llamar al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete("/api/alertas/no-es-uuid", BEARER),
      "no-es-uuid",
    );
    expect(respuesta.status).toBe(404);
    expect(servicio.borrar).not.toHaveBeenCalled();
  });
});

describe("A3 §8.15 · DELETE de la alerta de otro usuario → 404", () => {
  it("el servicio lanza 404 y la ruta lo traduce con la sesión del token", async () => {
    verificarSiempre(UID_B);
    const servicio = servicioBase();
    servicio.borrar.mockRejectedValue(new NoEncontrado("Alerta no encontrada"));
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/alertas/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(404);
    expect(servicio.borrar.mock.calls[0]?.[0]).toMatchObject({ uid: UID_B });
  });
});

// ---------------------------------------------------------------------------
// GET /api/alertas
// ---------------------------------------------------------------------------

describe("A3 §8.10 · GET sin since → 200 con items y servidor_ahora", () => {
  it("devuelve el cuerpo del servicio validado por RespuestaAlertasSchema", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockResolvedValue({
      items: [documentoDe(ID_ANA)],
      servidor_ahora: "2026-11-14T08:00:00.000Z",
    });
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/alertas", BEARER));
    expect(respuesta.status).toBe(200);
    const cuerpo = await leerAlertas(respuesta);
    expect(cuerpo.items).toHaveLength(1);
    expect(cuerpo.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });
});

describe("A3 §8.10 · GET ?since válido pasa el cursor al servicio", () => {
  it("pasa '2026-11-14T08:00:00.000Z' tal cual al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockResolvedValue({
      items: [],
      servidor_ahora: "2026-11-14T09:00:00.000Z",
    });
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/alertas?since=2026-11-14T08:00:00.000Z", BEARER));
    expect(respuesta.status).toBe(200);
    expect(servicio.listar.mock.calls[0]?.[1]).toBe("2026-11-14T08:00:00.000Z");
  });
});

describe("A3 §6 · GET con since inválido o no UTC → 400 con campo 'since'", () => {
  it.each([
    ["sin milisegundos ni Z", "2026-11-14T08:00:00"],
    ["solo la fecha", "2026-11-14"],
    ["con zona -05:00", "2026-11-14T08:00:00-05:00"],
  ])("since %s → 400 y detalles[0].campo === 'since'", async (_caso, valor) => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(
      peticionGet(`/api/alertas?since=${encodeURIComponent(valor)}`, BEARER),
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("since");
    expect(servicio.listar).not.toHaveBeenCalled();
  });

  it("since con 'Z' y milisegundos → 200", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockResolvedValue({ items: [], servidor_ahora: "2026-11-14T08:00:00.000Z" });
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/alertas?since=2026-11-14T08:00:00.000Z", BEARER));
    expect(respuesta.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/alertas/resumen
// ---------------------------------------------------------------------------

describe("A3 §8.11 y §8.12 · GET /resumen devuelve el cuerpo del servicio", () => {
  it("con meses → 200 y valida con ResumenAlertasSchema", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.resumen.mockResolvedValue({
      meses: [
        { mes: "2026-11", total: 2 },
        { mes: "2026-10", total: 1 },
      ],
      total: 3,
    });
    configurarServicio(servicio);
    const GET = await cargarResumen();
    const respuesta = await GET(peticionGet("/api/alertas/resumen", BEARER));
    expect(respuesta.status).toBe(200);
    const cuerpo = await leerResumen(respuesta);
    expect(cuerpo.meses).toEqual([
      { mes: "2026-11", total: 2 },
      { mes: "2026-10", total: 1 },
    ]);
    expect(cuerpo.total).toBe(3);
    expect(servicio.resumen.mock.calls[0]?.[0]).toMatchObject({ uid: UID_A });
  });

  it("sin alertas → 200 { meses: [], total: 0 }", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.resumen.mockResolvedValue({ meses: [], total: 0 });
    configurarServicio(servicio);
    const GET = await cargarResumen();
    const respuesta = await GET(peticionGet("/api/alertas/resumen", BEARER));
    expect(respuesta.status).toBe(200);
    expect(await leerResumen(respuesta)).toEqual({ meses: [], total: 0 });
  });
});

// ---------------------------------------------------------------------------
// Autorización (criterio 14) · sin token → 401 en las cuatro rutas
// ---------------------------------------------------------------------------

describe("A3 §8.14 · sin token → 401 'Falta la sesión' en las cuatro rutas", () => {
  it("GET /api/alertas sin Authorization → 401 'Falta la sesión'", async () => {
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/alertas"));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("PUT /api/alertas/<id> sin Authorization → 401 'Falta la sesión'", async () => {
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido()),
      ID_ANA,
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("DELETE /api/alertas/<id> sin Authorization → 401 'Falta la sesión'", async () => {
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(DELETE, peticionDelete(`/api/alertas/${ID_ANA}`), ID_ANA);
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("GET /api/alertas/resumen sin Authorization → 401 'Falta la sesión'", async () => {
    const GET = await cargarResumen();
    const respuesta = await GET(peticionGet("/api/alertas/resumen"));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("cabecera Basic → 401", async () => {
    const GET = await cargarListar();
    const respuesta = await GET(
      peticionGet("/api/alertas", { authorization: "Basic dXNlcjpwYXNz" }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("Bearer inválido → 401 'Sesión inválida o vencida'", async () => {
    const GET = await cargarResumen();
    const respuesta = await GET(peticionGet("/api/alertas/resumen", BEARER));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Sesión inválida o vencida");
  });

  it("sin token no se consulta el servicio de alertas", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarListar();
    await GET(peticionGet("/api/alertas"));
    expect(servicio.listar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transversales
// ---------------------------------------------------------------------------

describe("A3 §6 · un fallo inesperado del servicio → 500 opaco", () => {
  it("un error no de dominio en PUT responde 500 'Error interno' sin detalles", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(new Error("boom interno con stack"));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/alertas/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("boom interno");
  });

  it("ErrorInterno del servicio en resumen responde 500 sin detalles", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.resumen.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const GET = await cargarResumen();
    const respuesta = await GET(peticionGet("/api/alertas/resumen", BEARER));
    expect(respuesta.status).toBe(500);
    expect((await leerError(respuesta)).detalles).toBeUndefined();
  });
});
