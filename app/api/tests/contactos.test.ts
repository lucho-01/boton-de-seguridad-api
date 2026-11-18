import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  type Contacto,
  ContactoEscrituraSchema,
  ContactoSchema,
  ErrorHttpSchema,
  type RespuestaContactos,
  RespuestaContactosSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { Conflicto, ErrorInterno, NoAutenticado, NoEncontrado } from "@/shared/server/errors";

/**
 * Rutas HTTP de A2 (spec A2, §3, §5, §6, §8): `GET /api/contactos`,
 * `PUT /api/contactos/<id>` y `DELETE /api/contactos/<id>`.
 *
 * Se prueban las rutas REALES (con `manejar` y la validación Zod de la
 * frontera), pero el contenedor se sustituye por dobles con `vi.mock`: cero
 * red, cero Firebase, cero Firestore.
 */

const ID_ANA = "11111111-1111-4111-8111-111111111111";
const UID_A = "uid-ana";
const UID_B = "uid-beto";

/** Servicio de contactos que delega en funciones programables por la prueba. */
type DobleServicio = {
  listar: Mock<(sesion: Sesion, since?: string) => Promise<object>>;
  guardar: Mock<(sesion: Sesion, id: string, datos: object) => Promise<object>>;
  borrar: Mock<(sesion: Sesion, id: string) => Promise<object>>;
};

/** Estado compartido entre `vi.mock` (elevado) y las pruebas. */
type EstadoContenedor = {
  contactos: DobleServicio;
  verificar: (token: string) => Promise<Sesion>;
};

const estado = vi.hoisted((): EstadoContenedor => {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    contactos: {
      listar: vi.fn<(sesion: Sesion, since?: string) => Promise<object>>(siempreFalla),
      guardar: vi.fn<(sesion: Sesion, id: string, datos: object) => Promise<object>>(siempreFalla),
      borrar: vi.fn<(sesion: Sesion, id: string) => Promise<object>>(siempreFalla),
    },
    verificar: siempreFalla,
  };
});

vi.mock("@/features/container", () => {
  return {
    servicios: {
      get contactos() {
        return estado.contactos;
      },
    },
    verificadorDeToken: {
      verificar(token: string) {
        return estado.verificar(token);
      },
    },
  };
});

/** Programa el servicio de contactos de la siguiente llamada. */
function configurarServicio(servicio: DobleServicio): void {
  estado.contactos = servicio;
}

/** Verificador que resuelve siempre a la sesión indicada. */
function verificarSiempre(uid: string): void {
  estado.verificar = vi.fn<(token: string) => Promise<Sesion>>(() =>
    Promise.resolve(SesionSchema.parse({ uid, rol: "usuario" })),
  );
}

/** Doble por defecto que siempre falla; cada prueba lo reprograma. */
function servicioBase(): DobleServicio {
  const siempreFalla = (): Promise<never> => Promise.reject(new Error("sin configurar"));
  return {
    listar: vi.fn<(sesion: Sesion, since?: string) => Promise<object>>(siempreFalla),
    guardar: vi.fn<(sesion: Sesion, id: string, datos: object) => Promise<object>>(siempreFalla),
    borrar: vi.fn<(sesion: Sesion, id: string) => Promise<object>>(siempreFalla),
  };
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

/** Importa una sola vez para no duplicar `ErrorDeDominio` entre pruebas. */
async function cargarListar(): Promise<Handler> {
  const modulo = await import("../contactos/route");
  return modulo.GET;
}

async function cargarGuardar(): Promise<HandlerConId> {
  const modulo = await import("../contactos/[id]/route");
  return modulo.PUT;
}

async function cargarBorrar(): Promise<HandlerConId> {
  const modulo = await import("../contactos/[id]/route");
  return modulo.DELETE;
}

/**
 * Adapta el handler de `[id]` a la firma `(Request, contexto)` de Next, donde
 * `contexto.params` es una promesa con el segmento dinámico de la URL. Se
 * deriva el `id` de la ruta pedida para no duplicar llamadas a mano.
 */
async function ejecutarConId(
  handler: HandlerConId,
  peticion: Request,
  id: string,
): Promise<Response> {
  const contexto: ContextoRuta = { params: Promise.resolve({ id }) };
  return handler(peticion, contexto);
}

async function leerContactos(respuesta: Response): Promise<RespuestaContactos> {
  return RespuestaContactosSchema.parse(await respuesta.json());
}

async function leerContacto(respuesta: Response): Promise<Contacto> {
  return ContactoSchema.parse(await respuesta.json());
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

/** Documento del cable que devolvería un PUT correcto. */
function documentoDe(id: string, instante = "2026-11-14T08:00:00.000Z"): Contacto {
  return ContactoSchema.parse({
    id,
    nombre: "Ana Pérez",
    telefono: "3001234567",
    parentesco: "hija",
    created_at: instante,
    updated_at: instante,
    deleted_at: null,
  });
}

function cuerpoValido(parcial: object = {}): string {
  return JSON.stringify({
    nombre: "Ana Pérez",
    telefono: "3001234567",
    parentesco: "hija",
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

/**
 * Servicio de contactos con estado en memoria para pruebas de secuencia por
 * HTTP. Replica el contrato de `ServicioContactos` que consumen las rutas
 * (incluida la regla R4: el cupo se cuenta sobre los activos tras la escritura,
 * excluyendo el propio documento). Así la prueba valida el mapeo a `409` de la
 * ruta sin importar los módulos server de las features (prohibidos en api).
 */
type ContactoEnMemoria = Contacto;

type ServicioConEstado = {
  listar(sesion: Sesion, since?: string): Promise<object>;
  guardar(sesion: Sesion, id: string, datos: object): Promise<object>;
  borrar(sesion: Sesion, id: string): Promise<object>;
};

const INSTANTE = "2026-11-14T08:00:00.000Z";

function crearServicioConEstado(): ServicioConEstado {
  const porCuenta = new Map<string, Map<string, ContactoEnMemoria>>();
  function mapaDe(uid: string): Map<string, ContactoEnMemoria> {
    const existente = porCuenta.get(uid);
    if (existente !== undefined) {
      return existente;
    }
    const nuevo = new Map<string, ContactoEnMemoria>();
    porCuenta.set(uid, nuevo);
    return nuevo;
  }
  function contarActivos(mapa: Map<string, ContactoEnMemoria>): number {
    let total = 0;
    for (const item of mapa.values()) {
      if (item.deleted_at === null) {
        total += 1;
      }
    }
    return total;
  }
  return {
    async listar(sesion: Sesion): Promise<object> {
      const mapa = mapaDe(sesion.uid);
      return { items: [...mapa.values()].map((item) => ({ ...item })), servidor_ahora: INSTANTE };
    },
    async guardar(sesion: Sesion, id: string, datos: object): Promise<object> {
      const leido = ContactoEscrituraSchema.parse(datos);
      const mapa = mapaDe(sesion.uid);
      const previo = mapa.get(id);
      const estabaActivo = previo !== undefined && previo.deleted_at === null;
      let otrosActivos = contarActivos(mapa);
      if (estabaActivo) {
        otrosActivos -= 1;
      }
      if (!estabaActivo && otrosActivos >= 5) {
        throw new Conflicto("Máximo 5 contactos de confianza");
      }
      for (const otro of mapa.values()) {
        if (otro.id !== id && otro.deleted_at === null && otro.telefono === leido.telefono) {
          throw new Conflicto("Ese teléfono ya está en tus contactos");
        }
      }
      const documento: Contacto = ContactoSchema.parse({
        id,
        nombre: leido.nombre,
        telefono: leido.telefono,
        parentesco: leido.parentesco,
        created_at: previo?.created_at ?? INSTANTE,
        updated_at: INSTANTE,
        deleted_at: null,
      });
      mapa.set(id, documento);
      return documento;
    },
    async borrar(sesion: Sesion, id: string): Promise<object> {
      const mapa = mapaDe(sesion.uid);
      const previo = mapa.get(id);
      if (previo === undefined || previo.deleted_at !== null) {
        throw new NoEncontrado("Contacto no encontrado");
      }
      mapa.set(id, ContactoSchema.parse({ ...previo, deleted_at: INSTANTE, updated_at: INSTANTE }));
      return { ok: true };
    },
  };
}

/** Instala el servicio con estado como doble del contenedor. */
function configurarServicioConEstado(): void {
  const servicio = crearServicioConEstado();
  estado.contactos = {
    listar: vi.fn(servicio.listar),
    guardar: vi.fn(servicio.guardar),
    borrar: vi.fn(servicio.borrar),
  };
}

// ---------------------------------------------------------------------------
// PUT /api/contactos/<id>
// ---------------------------------------------------------------------------

describe("A2 §8.1 · PUT válido nuevo → 200 con el documento guardado", () => {
  it("responde 200 y el cuerpo valida con ContactoSchema (deleted_at null)", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    const guardado = await leerContacto(respuesta);
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
    await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(servicio.guardar).toHaveBeenCalledTimes(1);
    expect(servicio.guardar.mock.calls[0]?.[0]).toMatchObject({ uid: UID_A });
    expect(servicio.guardar.mock.calls[0]?.[1]).toBe(ID_ANA);
  });
});

describe("A2 §8.3 · PUT con teléfono inválido → 400 con campo 'telefono'", () => {
  it("'300 123 4567' → 400 y detalles[0].campo === 'telefono'", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ telefono: "300 123 4567" }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("telefono");
  });

  it("9 dígitos → 400 con campo 'telefono' y no se llama al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ telefono: "300123456" }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("telefono");
    expect(servicio.guardar).not.toHaveBeenCalled();
  });
});

describe("A2 §8.4 · PUT con nombre inválido → 400", () => {
  it("nombre de 61 caracteres → 400 con campo 'nombre'", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ nombre: "a".repeat(61) }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
    expect((await leerError(respuesta)).detalles?.[0]?.campo).toBe("nombre");
  });

  it("nombre solo con espacios → 400", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ nombre: "   " }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
  });

  it("nombre de 60 caracteres se acepta (borde)", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ nombre: "b".repeat(60) }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
  });
});

describe("A2 §8.14 · PUT con parentesco vacío se acepta y pasa al servicio", () => {
  it("parentesco '' → 200 y el servicio lo recibe como null", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido({ parentesco: "" }), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    expect(servicio.guardar.mock.calls[0]?.[2]).toMatchObject({ parentesco: null });
  });
});

describe("A2 §8.5 y §8.6 · PUT traduce los conflictos de negocio a 409", () => {
  it("límite de 5 → 409 'Máximo 5 contactos de confianza'", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(new Conflicto("Máximo 5 contactos de confianza"));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(409);
    expect((await leerError(respuesta)).error).toBe("Máximo 5 contactos de confianza");
  });

  it("teléfono repetido → 409 'Ese teléfono ya está en tus contactos'", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(new Conflicto("Ese teléfono ya está en tus contactos"));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(409);
    expect((await leerError(respuesta)).error).toBe("Ese teléfono ya está en tus contactos");
  });
});

describe("A2 §8.16 · PUT ignora los campos del cliente (uid, fechas, id)", () => {
  it("el cuerpo con uid/created_at/updated_at/deleted_at/id no los pasa al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockResolvedValue(documentoDe(ID_ANA));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    await ejecutarConId(
      PUT,
      peticionPut(
        `/api/contactos/${ID_ANA}`,
        cuerpoValido({
          uid: UID_B,
          created_at: "2000-01-01T00:00:00.000Z",
          updated_at: "2000-01-01T00:00:00.000Z",
          deleted_at: "2000-01-01T00:00:00.000Z",
          id: "otro-id",
        }),
        BEARER,
      ),
      ID_ANA,
    );
    const datos = servicio.guardar.mock.calls[0]?.[2];
    expect(datos).toEqual({ nombre: "Ana Pérez", telefono: "3001234567", parentesco: "hija" });
  });
});

describe("A2 §3 y §6 · PUT rechaza id no UUID y cuerpos no JSON", () => {
  it("id que no es UUID en la URL → 404 (ruta inexistente)", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut("/api/contactos/no-es-uuid", cuerpoValido(), BEARER),
      "no-es-uuid",
    );
    expect(respuesta.status).toBe(404);
  });

  it("Content-Type text/plain → 415", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      new Request(`http://localhost/api/contactos/${ID_ANA}`, {
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
      peticionPut(`/api/contactos/${ID_ANA}`, "", BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
  });

  it("JSON malformado → 400", async () => {
    verificarSiempre(UID_A);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, "{no-json", BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/contactos/<id>
// ---------------------------------------------------------------------------

describe("A2 §8.8 y §8.9 · DELETE lógico y su repetición", () => {
  it("DELETE de un existente → 200 { ok: true }", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrar.mockResolvedValue({ ok: true });
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/contactos/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ ok: true });
  });

  it("segundo DELETE → 404 'Contacto no encontrado'", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.borrar.mockRejectedValue(new NoEncontrado("Contacto no encontrado"));
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/contactos/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(404);
    expect((await leerError(respuesta)).error).toBe("Contacto no encontrado");
  });

  it("id que no es UUID → 404 sin llamar al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete("/api/contactos/no-es-uuid", BEARER),
      "no-es-uuid",
    );
    expect(respuesta.status).toBe(404);
    expect(servicio.borrar).not.toHaveBeenCalled();
  });
});

describe("A2 §8.10 · DELETE del contacto de otro usuario → 404", () => {
  it("el servicio lanza 404 y la ruta lo traduce", async () => {
    verificarSiempre(UID_B);
    const servicio = servicioBase();
    servicio.borrar.mockRejectedValue(new NoEncontrado("Contacto no encontrado"));
    configurarServicio(servicio);
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/contactos/${ID_ANA}`, BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(404);
    expect(servicio.borrar.mock.calls[0]?.[0]).toMatchObject({ uid: UID_B });
  });
});

// ---------------------------------------------------------------------------
// GET /api/contactos
// ---------------------------------------------------------------------------

describe("A2 §8.11 · GET sin since → 200 con items y servidor_ahora", () => {
  it("devuelve el cuerpo del servicio validado por RespuestaContactosSchema", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockResolvedValue({
      items: [documentoDe(ID_ANA)],
      servidor_ahora: "2026-11-14T08:00:00.000Z",
    });
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/contactos", BEARER));
    expect(respuesta.status).toBe(200);
    const cuerpo = await leerContactos(respuesta);
    expect(cuerpo.items).toHaveLength(1);
    expect(cuerpo.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });
});

describe("A2 §8.12 · GET ?since válido pasa el cursor al servicio", () => {
  it("pasa '2026-11-14T08:00:00.000Z' tal cual al servicio", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockResolvedValue({
      items: [],
      servidor_ahora: "2026-11-14T09:00:00.000Z",
    });
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(
      peticionGet("/api/contactos?since=2026-11-14T08:00:00.000Z", BEARER),
    );
    expect(respuesta.status).toBe(200);
    expect(servicio.listar.mock.calls[0]?.[1]).toBe("2026-11-14T08:00:00.000Z");
  });
});

describe("A2 §8.13 · GET con since inválido o no UTC → 400 con campo 'since'", () => {
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
      peticionGet(`/api/contactos?since=${encodeURIComponent(valor)}`, BEARER),
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
    const respuesta = await GET(
      peticionGet("/api/contactos?since=2026-11-14T08:00:00.000Z", BEARER),
    );
    expect(respuesta.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Autorización (criterio 15)
// ---------------------------------------------------------------------------

describe("A2 §8.15 · sin token → 401 'Falta la sesión' en las tres rutas", () => {
  it("GET sin Authorization → 401 'Falta la sesión'", async () => {
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/contactos"));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("PUT sin Authorization → 401 'Falta la sesión'", async () => {
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido()),
      ID_ANA,
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("DELETE sin Authorization → 401 'Falta la sesión'", async () => {
    const DELETE = await cargarBorrar();
    const respuesta = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/contactos/${ID_ANA}`),
      ID_ANA,
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Falta la sesión");
  });

  it("cabecera Basic → 401", async () => {
    const GET = await cargarListar();
    const respuesta = await GET(
      peticionGet("/api/contactos", { authorization: "Basic dXNlcjpwYXNz" }),
    );
    expect(respuesta.status).toBe(401);
  });

  it("Bearer inválido → 401 'Sesión inválida o vencida'", async () => {
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/contactos", BEARER));
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe("Sesión inválida o vencida");
  });

  it("sin token no se consulta el servicio de contactos", async () => {
    const servicio = servicioBase();
    configurarServicio(servicio);
    const GET = await cargarListar();
    await GET(peticionGet("/api/contactos"));
    expect(servicio.listar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Transversales
// ---------------------------------------------------------------------------

describe("A2 §6 · un fallo inesperado del servicio → 500 opaco", () => {
  it("un error no de dominio en PUT responde 500 'Error interno' sin detalles", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.guardar.mockRejectedValue(new Error("boom interno con stack"));
    configurarServicio(servicio);
    const PUT = await cargarGuardar();
    const respuesta = await ejecutarConId(
      PUT,
      peticionPut(`/api/contactos/${ID_ANA}`, cuerpoValido(), BEARER),
      ID_ANA,
    );
    expect(respuesta.status).toBe(500);
    const cuerpo = await leerError(respuesta);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("boom interno");
  });

  it("ErrorInterno del servicio responde 500 sin detalles", async () => {
    verificarSiempre(UID_A);
    const servicio = servicioBase();
    servicio.listar.mockRejectedValue(new ErrorInterno());
    configurarServicio(servicio);
    const GET = await cargarListar();
    const respuesta = await GET(peticionGet("/api/contactos", BEARER));
    expect(respuesta.status).toBe(500);
    expect((await leerError(respuesta)).detalles).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Regresión de seguridad (A2) · restaurar no puede rebasar el límite de 5
// ---------------------------------------------------------------------------

/** UUID determinista por número para la secuencia HTTP. */
function idHttp(indice: number): string {
  return `00000000-0000-4000-8000-${String(indice).padStart(12, "0")}`;
}

/** Teléfono determinista de 10 dígitos por número. */
function telHttp(indice: number): string {
  return String(3000000000 + indice);
}

/** Ruta `PUT /api/contactos/<id>` con nombre y teléfono deterministas. */
function peticionPutContacto(indice: number): Request {
  return peticionPut(
    `/api/contactos/${idHttp(indice)}`,
    cuerpoValido({ nombre: `C${indice}`, telefono: telHttp(indice) }),
    BEARER,
  );
}

describe("A2 §8.5/§8.17 (regresión security) · restaurar tras ocupar el hueco → 409 y 5 activos + 1 borrado", () => {
  it("PUT x5 → DELETE → PUT nuevo → PUT del borrado responde 409; GET trae 5 activos y 1 borrado", async () => {
    verificarSiempre(UID_A);
    configurarServicioConEstado();
    const PUT = await cargarGuardar();
    const DELETE = await cargarBorrar();
    const GET = await cargarListar();

    for (let indice = 1; indice <= 5; indice += 1) {
      const respuesta = await ejecutarConId(PUT, peticionPutContacto(indice), idHttp(indice));
      expect(respuesta.status).toBe(200);
    }

    const borrado = await ejecutarConId(
      DELETE,
      peticionDelete(`/api/contactos/${idHttp(1)}`, BEARER),
      idHttp(1),
    );
    expect(borrado.status).toBe(200);

    const ocupaHueco = await ejecutarConId(PUT, peticionPutContacto(6), idHttp(6));
    expect(ocupaHueco.status).toBe(200);

    const restaura = await ejecutarConId(PUT, peticionPutContacto(1), idHttp(1));
    expect(restaura.status).toBe(409);
    expect((await leerError(restaura)).error).toBe("Máximo 5 contactos de confianza");

    const respuesta = await GET(peticionGet("/api/contactos", BEARER));
    expect(respuesta.status).toBe(200);
    const lista = await leerContactos(respuesta);
    expect(lista.items).toHaveLength(6);
    expect(lista.items.filter((item) => item.deleted_at === null)).toHaveLength(5);
    expect(lista.items.filter((item) => item.deleted_at !== null)).toHaveLength(1);
  });

  it("sin ocupar el hueco, restaurar el borrado → 200 y 5 activos", async () => {
    verificarSiempre(UID_A);
    configurarServicioConEstado();
    const PUT = await cargarGuardar();
    const DELETE = await cargarBorrar();
    const GET = await cargarListar();

    for (let indice = 1; indice <= 5; indice += 1) {
      await ejecutarConId(PUT, peticionPutContacto(indice), idHttp(indice));
    }
    await ejecutarConId(DELETE, peticionDelete(`/api/contactos/${idHttp(1)}`, BEARER), idHttp(1));
    const restaura = await ejecutarConId(PUT, peticionPutContacto(1), idHttp(1));
    expect(restaura.status).toBe(200);
    const respuesta = await GET(peticionGet("/api/contactos", BEARER));
    const lista = await leerContactos(respuesta);
    expect(lista.items.filter((item) => item.deleted_at === null)).toHaveLength(5);
  });
});
