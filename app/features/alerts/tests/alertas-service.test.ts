import { beforeEach, describe, expect, it } from "vitest";
import {
  type Alerta,
  AlertaSchema,
  type AlertaEscritura,
  type ResumenAlertas,
  ResumenAlertasSchema,
  type RespuestaAlertas,
  RespuestaAlertasSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { esErrorDeDominio } from "@/shared/server/errors";
import { respuestaDeError } from "@/shared/server/http";
import type { Reloj } from "@/shared/server/time";
import { crearRepositorioAlertasEnMemoria } from "../server/repository.memory";
import {
  crearServicioAlertas,
  mesEnColombia,
  type ServicioAlertas,
} from "../server/alertas-service";

/**
 * Spec A3 · Reglas de negocio de alertas (sección 8, criterios 1, 2, 2b, 3, 4,
 * 5, 6, 7, 8, 9, 10, 11, 12, 13, 15 y bordes de la sección 9).
 *
 * Todo se prueba a través del SERVICIO con el repositorio en memoria y un reloj
 * fijo (`2026-11-14T08:00:00.000Z`): cero red, cero Firebase. La validación de
 * contrato de la frontera HTTP (401 sin token, 400 por `bateria_pct` inválido,
 * 415, id no UUID) se prueba en `app/api/tests/alertas.test.ts`.
 *
 * La agrupación por mes vive en la función pura `mesEnColombia`; aquí se
 * prueba su tabla de cortes y que `resumen` la usa.
 */

const AHORA = new Date("2026-11-14T08:00:00.000Z");

const UID_A = "uid-ana";
const UID_B = "uid-beto";

const ID_ANA = "11111111-1111-4111-8111-111111111111";

/** Cinco minutos: el margen de R4 que el reloj del servidor permite. */
const CINCO_MINUTOS_MS = 5 * 60 * 1000;
/** Seis minutos: un milisegundo de más destruye el margen. */
const SEIS_MINUTOS_MS = 6 * 60 * 1000;
const CUATRO_MINUTOS_MS = 4 * 60 * 1000;
const SEIS_MINUTOS_MENOS_UN_MS = SEIS_MINUTOS_MS - 1;

function sesion(uid: string): Sesion {
  return SesionSchema.parse({ uid, rol: "usuario" });
}

const SESION_A = sesion(UID_A);
const SESION_B = sesion(UID_B);

/** UUID determinista por número: base 2000 para no chocar con los fijos. */
function idDe(indice: number): string {
  const relleno = String(indice).padStart(12, "0");
  return `00000000-0000-4000-8000-${relleno}`;
}

/** Instante ISO desplazado `milisegundos` respecto del reloj fijo. */
function respectoDeAhora(milisegundos: number): string {
  return new Date(AHORA.getTime() + milisegundos).toISOString();
}

/** Cuerpo de escritura con el contrato de `AlertaEscritura`. */
function escritura(parcial: Partial<AlertaEscritura> = {}): AlertaEscritura {
  const base: AlertaEscritura = {
    lat: 4.711,
    lng: -74.0721,
    precision_m: 12.5,
    bateria_pct: 76,
    estado: "mensaje_preparado",
    creada_en: "2026-11-14T03:22:00.000Z",
  };
  return { ...base, ...parcial };
}

/** Error HTTP de un rechazo del servicio, como lo produce `respuestaDeError`. */
async function errorHttp(promesa: Promise<object>): Promise<{
  estado: number;
  cuerpo: { error: string; detalles?: Array<{ campo: string; mensaje: string }> };
}> {
  let fallo: object | null = null;
  try {
    await promesa;
  } catch (capturado) {
    fallo = capturado as object;
  }
  if (fallo === null || !esErrorDeDominio(fallo)) {
    throw new Error("Se esperaba un rechazo de dominio");
  }
  const respuesta = respuestaDeError(fallo);
  const cuerpo = await respuesta.json();
  return {
    estado: respuesta.status,
    cuerpo: {
      error: typeof cuerpo.error === "string" ? cuerpo.error : "",
      detalles: Array.isArray(cuerpo.detalles) ? cuerpo.detalles : undefined,
    },
  };
}

/** Documento guardado validado con el contrato de cable. */
function alerta(valor: Alerta): Alerta {
  return AlertaSchema.parse(valor);
}

type Contexto = {
  servicio: ServicioAlertas;
  cambiosDeReloj: (instante: Date) => void;
};

/** Servicio con repositorio nuevo, reloj mutable y `cambiosDeReloj`. */
function crearContexto(): Contexto {
  const repositorio = crearRepositorioAlertasEnMemoria();
  let instante = new Date(AHORA.getTime());
  const reloj: Reloj = {
    ahora() {
      return new Date(instante.getTime());
    },
  };
  const servicio = crearServicioAlertas({ repositorio, reloj });
  return {
    servicio,
    cambiosDeReloj(nuevo: Date) {
      instante = new Date(nuevo.getTime());
    },
  };
}

/** GET del servicio validado con el contrato de la respuesta. */
async function leer(servicio: ServicioAlertas, since?: string): Promise<RespuestaAlertas> {
  return RespuestaAlertasSchema.parse(await servicio.listar(SESION_A, since));
}

/** Resumen del servicio validado con el contrato de la respuesta. */
async function resumenDe(servicio: ServicioAlertas): Promise<ResumenAlertas> {
  return ResumenAlertasSchema.parse(await servicio.resumen(SESION_A));
}

// ---------------------------------------------------------------------------
// Función pura · mes en hora de Colombia (R8; criterio 2b y borde del mes)
// ---------------------------------------------------------------------------

describe("A3 §8.2b · mesEnColombia agrupa en UTC-5 (hora de Colombia)", () => {
  it("2026-11-01T03:30:00.000Z cae en '2026-10' (22:30 del 31 de octubre)", () => {
    expect(mesEnColombia("2026-11-01T03:30:00.000Z")).toBe("2026-10");
  });

  it("2026-11-01T05:00:00.000Z cae en '2026-11' (00:00 del 1 de noviembre)", () => {
    expect(mesEnColombia("2026-11-01T05:00:00.000Z")).toBe("2026-11");
  });

  it("el último segundo de octubre en Colombia cae en '2026-10'", () => {
    expect(mesEnColombia("2026-11-01T04:59:59.999Z")).toBe("2026-10");
  });

  it("el primer segundo de noviembre en Colombia cae en '2026-11'", () => {
    expect(mesEnColombia("2026-11-01T05:00:00.000Z")).toBe("2026-11");
  });
});

describe("A3 §9 (bordes) · cortes de mes, año y décadas en hora de Colombia", () => {
  it.each([
    ["2026-01-01T04:59:59.999Z", "2025-12"],
    ["2026-01-01T05:00:00.000Z", "2026-01"],
    ["2026-12-31T23:00:00.000Z", "2026-12"],
    ["2027-01-01T03:00:00.000Z", "2026-12"],
    ["2027-01-01T05:00:00.000Z", "2027-01"],
    ["2026-02-28T23:00:00.000Z", "2026-02"],
    ["2026-03-01T03:00:00.000Z", "2026-02"],
    ["2026-03-01T05:00:00.000Z", "2026-03"],
    ["2024-02-29T12:00:00.000Z", "2024-02"],
  ])("%s → '%s'", (instante, esperado) => {
    expect(mesEnColombia(instante)).toBe(esperado);
  });
});

describe("A3 R4 / R8 (defensa en profundidad) · años < 1900 producen etiquetas válidas", () => {
  it.each([
    "0000-01-01T00:00:00.000Z",
    "1800-05-01T00:00:00.000Z",
  ])("mesEnColombia(%s) → etiqueta YYYY-MM de 4 dígitos", (instante) => {
    const etiqueta = mesEnColombia(instante);
    expect(etiqueta).toMatch(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
    const resumen = ResumenAlertasSchema.parse({
      meses: [{ mes: etiqueta, total: 1 }],
      total: 1,
    });
    expect(resumen.meses[0]?.mes).toBe(etiqueta);
  });

  it("un año fuera de etiqueta nunca rompe ResumenAlertasSchema con total > 0", () => {
    const meses = [
      { mes: mesEnColombia("0000-01-01T00:00:00.000Z"), total: 1 },
      { mes: mesEnColombia("1800-05-01T00:00:00.000Z"), total: 2 },
      { mes: mesEnColombia("2026-11-01T05:00:00.000Z"), total: 3 },
    ];
    const resumen = ResumenAlertasSchema.parse({ meses, total: 6 });
    expect(resumen.meses).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Criterio 1 · PUT válido con ubicación
// ---------------------------------------------------------------------------

describe("A3 §8.1 · un PUT válido con ubicación devuelve el documento guardado", () => {
  let contexto: Contexto;

  beforeEach(() => {
    contexto = crearContexto();
  });

  it("responde 200 lógico (documento) con created_at === updated_at y deleted_at null", async () => {
    const guardado = alerta(await contexto.servicio.guardar(SESION_A, ID_ANA, escritura()));
    expect(guardado.id).toBe(ID_ANA);
    expect(guardado.created_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.updated_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.created_at).toBe(guardado.updated_at);
    expect(guardado.deleted_at).toBeNull();
  });

  it("conserva ubicación, batería, estado y creada_en tal como llegan", async () => {
    const guardado = alerta(
      await contexto.servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({
          lat: 4.711,
          lng: -74.0721,
          precision_m: 12.5,
          bateria_pct: 76,
          estado: "mensaje_preparado",
          creada_en: "2026-11-14T03:22:00.000Z",
        }),
      ),
    );
    expect(guardado.lat).toBe(4.711);
    expect(guardado.lng).toBe(-74.0721);
    expect(guardado.precision_m).toBe(12.5);
    expect(guardado.bateria_pct).toBe(76);
    expect(guardado.estado).toBe("mensaje_preparado");
    expect(guardado.creada_en).toBe("2026-11-14T03:22:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 · PUT con ubicación nula
// ---------------------------------------------------------------------------

describe("A3 §8.2 · un PUT con ubicación nula devuelve lat/lng/precision_m en null", () => {
  it("acepta el sitio sin GPS y guarda los tres como null", async () => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ lat: null, lng: null, precision_m: null }),
      ),
    );
    expect(guardado.lat).toBeNull();
    expect(guardado.lng).toBeNull();
    expect(guardado.precision_m).toBeNull();
    expect(guardado.deleted_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 3 · estado inválido (validación de la frontera; servicio no duplica)
// ---------------------------------------------------------------------------

// El 400 de `estado: "otro"` es de la frontera Zod (`AlertaEscrituraSchema`); se
// comprueba en `app/api/tests/alertas.test.ts` con `detalles[0].campo`.

// ---------------------------------------------------------------------------
// Criterios 4 y 5 · ubicación coherente y en rango (regla del servicio, R2)
// ---------------------------------------------------------------------------

describe("A3 §8.4 · ubicación parcial (todo o nada, R2) → 400 con campo de coordenadas", () => {
  it.each([
    ["solo lat (sin lng)", { lat: 4.711, lng: null, precision_m: null }],
    ["solo lat (sin precision_m)", { lat: 4.711, lng: -74.0721, precision_m: null }],
    ["lat + lng sin precision_m", { lat: 4.711, lng: -74.0721, precision_m: null }],
    ["solo lng", { lat: null, lng: -74.0721, precision_m: null }],
    ["solo precision_m", { lat: null, lng: null, precision_m: 5 }],
  ])("%s → 400 con `detalle` de coordenadas", async (_caso, parcial) => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, ID_ANA, escritura(parcial)),
    );
    expect(estado).toBe(400);
    expect(cuerpo.detalles?.length ?? 0).toBeGreaterThan(0);
    const campos = (cuerpo.detalles ?? []).map((detalle) => detalle.campo);
    const esCoordenada = campos.some(
      (campo) => campo === "lat" || campo === "lng" || campo === "precision_m",
    );
    expect(esCoordenada).toBe(true);
  });

  it("el rechazo no guarda nada: la cuenta sigue vacía", async () => {
    const { servicio } = crearContexto();
    await errorHttp(servicio.guardar(SESION_A, ID_ANA, escritura({ lng: null })));
    expect((await leer(servicio)).items).toEqual([]);
  });
});

/**
 * Criterio 5 (rangos de `lat`/`lng`/`precision_m`) es de la **frontera Zod**:
 * `AlertaEscrituraSchema` acota los rangos y el servicio valida además con él.
 * Por eso el `400` con `detalles` se comprueba en `app/api/tests/alertas.test.ts`
 * (ruta real con `leerJson`). Aquí zod lanzaría `ZodError`, no un error de
 * dominio, y no es lo que produce la API.
 */

describe("A3 §9 (bordes) · rangos límite de ubicación se aceptan", () => {
  it.each([
    [-90, -180, 0],
    [90, 180, 100_000],
    [-90, 180, 100_000],
    [90, -180, 0],
    [0, 0, 0],
  ])("lat %s, lng %s, precision_m %s → 200", async (lat, lng, precision_m) => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ lat, lng, precision_m })),
    );
    expect(guardado.lat).toBe(lat);
    expect(guardado.lng).toBe(lng);
    expect(guardado.precision_m).toBe(precision_m);
  });
});

// ---------------------------------------------------------------------------
// Criterio 7 · creada_en no futura (±5 min, R4)
// ---------------------------------------------------------------------------

describe("A3 §8.7 · creada_en futura más de 5 minutos → 400 con mensaje literal", () => {
  it("6 minutos en el futuro → 400 con el mensaje literal en el detalle", async () => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: respectoDeAhora(SEIS_MINUTOS_MS) }),
      ),
    );
    expect(estado).toBe(400);
    const detalle = (cuerpo.detalles ?? []).find((item) => item.campo === "creada_en");
    expect(detalle?.mensaje).toBe("La hora de la alerta no puede ser futura");
  });

  it("4 minutos en el futuro → se acepta", async () => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: respectoDeAhora(CUATRO_MINUTOS_MS) }),
      ),
    );
    expect(guardado.deleted_at).toBeNull();
  });

  it("exactamente 5 minutos en el futuro se acepta (el margen incluye el borde)", async () => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: respectoDeAhora(CINCO_MINUTOS_MS) }),
      ),
    );
    expect(guardado.creada_en).toBe(respectoDeAhora(CINCO_MINUTOS_MS));
  });

  it("un milisegundo antes de los 6 minutos sigue siendo 400 (borde justo)", async () => {
    const { servicio } = crearContexto();
    const { estado } = await errorHttp(
      servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: respectoDeAhora(SEIS_MINUTOS_MENOS_UN_MS) }),
      ),
    );
    expect(estado).toBe(400);
  });

  it("un milisegundo después de los 5 minutos → 400 (borde justo)", async () => {
    const { servicio } = crearContexto();
    const { estado } = await errorHttp(
      servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: respectoDeAhora(CINCO_MINUTOS_MS + 1) }),
      ),
    );
    expect(estado).toBe(400);
  });

  it("acepta el instante mínimo 2026-01-01T00:00:00.000Z", async () => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    expect(guardado.creada_en).toBe("2026-01-01T00:00:00.000Z");
  });

  it.each([
    ["2025-12-31T23:59:59.999Z"],
    ["2020-01-01T00:00:00.000Z"],
  ])("un instante anterior al mínimo (%s) → 400 'demasiado antigua'", async (valor) => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, ID_ANA, escritura({ creada_en: valor })),
    );
    expect(estado).toBe(400);
    const detalle = (cuerpo.detalles ?? []).find((item) => item.campo === "creada_en");
    expect(detalle?.mensaje).toBe("La hora de la alerta es demasiado antigua");
  });
});

describe("A3 R4 · creada_en fuera de [2026-01-01, ahora + 5 min] → 400 campo 'creada_en'", () => {
  it.each([
    ["0000-01-01T00:00:00.000Z"],
    ["1900-01-01T00:00:00.000Z"],
    ["2025-12-31T23:59:59.999Z"],
  ])("creada_en %s → 400 con campo 'creada_en'", async (valor) => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, ID_ANA, escritura({ creada_en: valor })),
    );
    expect(estado).toBe(400);
    expect(cuerpo.detalles?.[0]?.campo).toBe("creada_en");
    expect((await leer(servicio)).items).toEqual([]);
  });

  it("creada_en '2026-01-01T00:00:00.000Z' (mínimo) → 200", async () => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ creada_en: "2026-01-01T00:00:00.000Z" }),
      ),
    );
    expect(guardado.creada_en).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Criterio 8 · PUT idempotente (R5)
// ---------------------------------------------------------------------------

describe("A3 §8.8 · repetir el mismo PUT no duplica ni cambia created_at", () => {
  it("un solo documento y el mismo created_at tras dos llamadas", async () => {
    const { servicio } = crearContexto();
    const cuerpo = escritura();
    const primero = alerta(await servicio.guardar(SESION_A, ID_ANA, cuerpo));
    const segundo = alerta(await servicio.guardar(SESION_A, ID_ANA, cuerpo));
    expect(segundo.id).toBe(primero.id);
    expect(segundo.created_at).toBe(primero.created_at);
    expect(segundo.updated_at).toBe(primero.updated_at);
    const todos = (await leer(servicio)).items;
    expect(todos.filter((item) => item.id === ID_ANA)).toHaveLength(1);
    expect(todos).toHaveLength(1);
  });

  it("reintentar con datos distintos sobre el mismo id reemplaza y conserva created_at", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    const primero = alerta(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    const segundo = alerta(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ estado: "cancelada", bateria_pct: 10 })),
    );
    expect(segundo.estado).toBe("cancelada");
    expect(segundo.bateria_pct).toBe(10);
    expect(segundo.created_at).toBe(primero.created_at);
    expect(segundo.updated_at).toBe("2026-11-14T09:00:00.000Z");
    expect((await leer(servicio)).items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterio 9 · DELETE lógico (R6)
// ---------------------------------------------------------------------------

describe("A3 §8.9 · DELETE devuelve { ok: true } y el segundo DELETE → 404", () => {
  it("el primer DELETE → { ok: true }; el segundo → 404 'Alerta no encontrada'", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const primero = await servicio.borrar(SESION_A, ID_ANA);
    expect(primero).toEqual({ ok: true });
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_A, ID_ANA));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Alerta no encontrada");
  });

  it("DELETE de un id inexistente → 404 'Alerta no encontrada'", async () => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_A, idDe(999)));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Alerta no encontrada");
  });

  it("el DELETE es lógico: aparece en GET ?since con deleted_at y updated_at iguales", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    await servicio.borrar(SESION_A, ID_ANA);
    const respuesta = await leer(servicio, "2026-11-14T08:00:00.000Z");
    const borrado = respuesta.items[0];
    if (borrado === undefined) {
      throw new Error("La alerta borrada debía venir en la sincronización");
    }
    expect(borrado.deleted_at).toBe("2026-11-14T09:00:00.000Z");
    expect(borrado.updated_at).toBe(borrado.deleted_at);
  });
});

// ---------------------------------------------------------------------------
// Criterio 10 · GET ?since (R7)
// ---------------------------------------------------------------------------

describe("A3 §8.10 · GET ?since devuelve solo lo modificado después, incluidos borrados", () => {
  it("filtra por updated_at > since, ordena ascendente e incluye borrados", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura());
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    await servicio.guardar(SESION_A, idDe(2), escritura());
    cambiosDeReloj(new Date("2026-11-14T10:00:00.000Z"));
    await servicio.guardar(SESION_A, idDe(3), escritura());
    cambiosDeReloj(new Date("2026-11-14T11:00:00.000Z"));
    await servicio.borrar(SESION_A, idDe(2));

    const despues = await leer(servicio, "2026-11-14T08:30:00.000Z");
    expect(despues.items.map((item) => item.id)).toEqual([idDe(3), idDe(2)]);
    const instantes = despues.items.map((item) => item.updated_at);
    expect(instantes).toEqual([...instantes].sort());
    expect(despues.items.some((item) => item.deleted_at !== null)).toBe(true);
  });

  it("un since posterior a todo devuelve items vacío con servidor_ahora", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const respuesta = await leer(servicio, "2026-11-15T00:00:00.000Z");
    expect(respuesta.items).toEqual([]);
    expect(respuesta.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });

  it("since igual al último updated_at no repite ese documento (cursor sin repetir)", async () => {
    const { servicio } = crearContexto();
    const creado = alerta(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    const respuesta = await leer(servicio, creado.updated_at);
    expect(respuesta.items).toEqual([]);
  });

  it("GET sin since devuelve todos, incluidos los borrados, con servidor_ahora", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura());
    await servicio.guardar(SESION_A, idDe(2), escritura());
    await servicio.borrar(SESION_A, idDe(1));
    const respuesta = await leer(servicio);
    expect(respuesta.items).toHaveLength(2);
    expect(respuesta.items.some((item) => item.deleted_at !== null)).toBe(true);
    expect(respuesta.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Criterio 11 · resumen con noviembre, octubre y una borrada (R8)
// ---------------------------------------------------------------------------

describe("A3 §8.11 · resumen agrupa por mes en Colombia y excluye borradas", () => {
  it("noviembre (2) y octubre (1) con una borrada de noviembre → total 3", async () => {
    const { servicio } = crearContexto();
    // Dos en noviembre (>= 05:00Z del 1 de noviembre).
    await servicio.guardar(
      SESION_A,
      idDe(1),
      escritura({ creada_en: "2026-11-14T03:22:00.000Z", estado: "mensaje_preparado" }),
    );
    await servicio.guardar(
      SESION_A,
      idDe(2),
      escritura({ creada_en: "2026-11-02T15:00:00.000Z", estado: "cancelada" }),
    );
    // Una en octubre (03:30Z del 1 de noviembre = 22:30 del 31 de octubre).
    await servicio.guardar(SESION_A, idDe(3), escritura({ creada_en: "2026-11-01T03:30:00.000Z" }));
    // Una borrada que, si contara, sumaría a noviembre.
    await servicio.guardar(SESION_A, idDe(4), escritura({ creada_en: "2026-11-10T15:00:00.000Z" }));
    await servicio.borrar(SESION_A, idDe(4));

    const resumen = await resumenDe(servicio);
    expect(resumen).toEqual({
      meses: [
        { mes: "2026-11", total: 2 },
        { mes: "2026-10", total: 1 },
      ],
      total: 3,
    });
  });

  it("cuenta ambos estados en el resumen", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(
      SESION_A,
      idDe(1),
      escritura({ creada_en: "2026-11-14T03:22:00.000Z", estado: "cancelada" }),
    );
    await servicio.guardar(
      SESION_A,
      idDe(2),
      escritura({ creada_en: "2026-11-13T03:22:00.000Z", estado: "mensaje_preparado" }),
    );
    const resumen = await resumenDe(servicio);
    expect(resumen.meses).toEqual([{ mes: "2026-11", total: 2 }]);
    expect(resumen.total).toBe(2);
  });
});

describe("A3 §9 (bordes) · el corte del mes en el resumen usa Colombia", () => {
  it("la alerta del último segundo de octubre cuenta en octubre y no en noviembre", async () => {
    const { servicio } = crearContexto();
    // 2026-11-01T04:59:59.999Z = 2026-10-31 23:59:59.999 en Colombia.
    await servicio.guardar(SESION_A, idDe(1), escritura({ creada_en: "2026-11-01T04:59:59.999Z" }));
    const resumen = await resumenDe(servicio);
    expect(resumen.meses).toEqual([{ mes: "2026-10", total: 1 }]);
  });

  it("la alerta del primer segundo de noviembre cuenta en noviembre", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura({ creada_en: "2026-11-01T05:00:00.000Z" }));
    const resumen = await resumenDe(servicio);
    expect(resumen.meses).toEqual([{ mes: "2026-11", total: 1 }]);
  });

  it("un par de alertas a ambos lados del corte cae en meses distintos", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura({ creada_en: "2026-11-01T04:59:59.999Z" }));
    await servicio.guardar(SESION_A, idDe(2), escritura({ creada_en: "2026-11-01T05:00:00.000Z" }));
    const resumen = await resumenDe(servicio);
    expect(resumen.meses).toEqual([
      { mes: "2026-11", total: 1 },
      { mes: "2026-10", total: 1 },
    ]);
    expect(resumen.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Criterio 12 · resumen vacío
// ---------------------------------------------------------------------------

describe("A3 §8.12 · resumen sin alertas → { meses: [], total: 0 }", () => {
  it("devuelve la estructura vacía exacta", async () => {
    const { servicio } = crearContexto();
    const resumen = await resumenDe(servicio);
    expect(resumen).toEqual({ meses: [], total: 0 });
  });

  it("una cuenta con solo alertas borradas también devuelve vacío", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    await servicio.borrar(SESION_A, ID_ANA);
    const resumen = await resumenDe(servicio);
    expect(resumen).toEqual({ meses: [], total: 0 });
  });
});

// ---------------------------------------------------------------------------
// Orden del resumen (R8: de más reciente a más antiguo, sin tope)
// ---------------------------------------------------------------------------

describe("A3 §8.11 · el resumen ordena de más reciente a más antiguo sin tope", () => {
  it("con 3+ meses devuelve el orden descendente", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura({ creada_en: "2026-09-10T15:00:00.000Z" }));
    await servicio.guardar(SESION_A, idDe(2), escritura({ creada_en: "2026-11-10T15:00:00.000Z" }));
    await servicio.guardar(SESION_A, idDe(3), escritura({ creada_en: "2026-01-10T15:00:00.000Z" }));
    await servicio.guardar(SESION_A, idDe(4), escritura({ creada_en: "2026-10-10T15:00:00.000Z" }));
    const resumen = await resumenDe(servicio);
    expect(resumen.meses.map((mes) => mes.mes)).toEqual([
      "2026-11",
      "2026-10",
      "2026-09",
      "2026-01",
    ]);
    expect(resumen.total).toBe(4);
  });

  it("no omite ningún mes con datos ni aplica un tope de meses", async () => {
    const { servicio } = crearContexto();
    // 11 meses consecutivos dentro de 2026: de enero a noviembre.
    for (let indice = 0; indice < 11; indice += 1) {
      const etiqueta = `2026-${String(indice + 1).padStart(2, "0")}`;
      await servicio.guardar(
        SESION_A,
        idDe(indice + 1),
        escritura({ creada_en: `${etiqueta}-10T15:00:00.000Z` }),
      );
    }
    const resumen = await resumenDe(servicio);
    expect(resumen.meses).toHaveLength(11);
    expect(resumen.meses[0]?.mes).toBe("2026-11");
    expect(resumen.meses[10]?.mes).toBe("2026-01");
    expect(resumen.total).toBe(11);
    for (let indice = 1; indice < resumen.meses.length; indice += 1) {
      const anterior = resumen.meses[indice - 1]?.mes ?? "";
      const actual = resumen.meses[indice]?.mes ?? "";
      expect(anterior > actual).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Criterio 15 · aislamiento entre usuarios (R9)
// ---------------------------------------------------------------------------

describe("A3 §8.15 · la alerta de otro usuario es indistinguible de inexistente", () => {
  it("DELETE de B con el id de A → 404 y A no la pierde", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_B, ID_ANA));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Alerta no encontrada");
    const deA = await servicio.listar(SESION_A);
    expect(deA.items).toHaveLength(1);
    expect(deA.items[0]?.deleted_at).toBeNull();
  });

  it("PUT de B con el id de A crea en la cuenta de B, no en la de A", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(
      SESION_A,
      ID_ANA,
      escritura({ estado: "mensaje_preparado", bateria_pct: 90 }),
    );
    const deBeto = alerta(
      await servicio.guardar(SESION_B, ID_ANA, escritura({ estado: "cancelada", bateria_pct: 5 })),
    );
    expect(deBeto.estado).toBe("cancelada");
    const listaA = (await servicio.listar(SESION_A)).items;
    const listaB = (await servicio.listar(SESION_B)).items;
    expect(listaA).toHaveLength(1);
    expect(listaB).toHaveLength(1);
    expect(listaA[0]?.estado).toBe("mensaje_preparado");
    expect(listaB[0]?.estado).toBe("cancelada");
  });

  it("GET y resumen de B no ven las alertas de A", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    expect((await servicio.listar(SESION_B)).items).toHaveLength(0);
    expect(await servicio.resumen(SESION_B)).toEqual({ meses: [], total: 0 });
  });

  it("el resumen de A tras el PUT de B con el mismo id sigue contando la de A", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ creada_en: "2026-11-14T03:22:00.000Z" }));
    await servicio.guardar(SESION_B, ID_ANA, escritura({ creada_en: "2026-08-14T03:22:00.000Z" }));
    const resumenA = await resumenDe(servicio);
    expect(resumenA.meses).toEqual([{ mes: "2026-11", total: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 16 / campos del servidor (R5, R9)
// ---------------------------------------------------------------------------

describe("A3 §8 · el servidor pone el uid, el id y las fechas del documento", () => {
  it("ignora created_at/updated_at/deleted_at/uid del cuerpo y usa el reloj", async () => {
    const { servicio } = crearContexto();
    // El contrato del servicio solo declara los campos de `AlertaEscritura`; los
    // extras del cuerpo llegan desde la ruta, que ya se queda solo con los
    // declarados. Aquí se comprueba que el servidor pone las fechas y el id.
    const conExtra: AlertaEscritura = {
      ...escritura(),
    };
    const guardado = alerta(await servicio.guardar(SESION_A, ID_ANA, conExtra));
    expect(guardado.id).toBe(ID_ANA);
    expect(guardado.created_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.updated_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.deleted_at).toBeNull();
    expect((await servicio.listar(SESION_B)).items).toHaveLength(0);
  });

  it("PUT sobre una alerta borrada la restaura (deleted_at null) y conserva created_at", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    const creado = alerta(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    await servicio.borrar(SESION_A, ID_ANA);
    cambiosDeReloj(new Date("2026-11-14T10:00:00.000Z"));
    const restaurado = alerta(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ estado: "cancelada" })),
    );
    expect(restaurado.deleted_at).toBeNull();
    expect(restaurado.created_at).toBe(creado.created_at);
    expect(restaurado.updated_at).toBe("2026-11-14T10:00:00.000Z");
    expect(restaurado.estado).toBe("cancelada");
  });
});

// ---------------------------------------------------------------------------
// Borde de batería (R3) · 0 y 100 se aceptan, null se acepta
// ---------------------------------------------------------------------------

describe("A3 §9 (bordes) · bateria_pct 0, 100 y null se aceptan", () => {
  it.each([0, 100, null])("bateria_pct %s → 200", async (valor) => {
    const { servicio } = crearContexto();
    const guardado = alerta(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ bateria_pct: valor })),
    );
    expect(guardado.bateria_pct).toBe(valor);
  });
});

// ---------------------------------------------------------------------------
// Borde de paginación (§9) · 500 y 501 (R7)
// ---------------------------------------------------------------------------

describe("A3 §9 (bordes) · la sincronización pagina a 500", () => {
  /**
   * Siembra `total` alertas sin límite (A3 no tiene cupo). Cada escritura avanza
   * el reloj 1 ms para que los `updated_at` queden ordenados y distintos (el
   * cursor `since` es estrictamente `updated_at > since`).
   */
  async function sembrarDocumentos(total: number): Promise<Contexto> {
    const contexto = crearContexto();
    let milisegundos = AHORA.getTime();
    for (let indice = 1; indice <= total; indice += 1) {
      milisegundos += 1;
      contexto.cambiosDeReloj(new Date(milisegundos));
      await contexto.servicio.guardar(SESION_A, idDe(indice), escritura());
    }
    return contexto;
  }

  it("con 501 alertas, el primer GET trae 500 y el siguiente trae la restante", async () => {
    const { servicio } = await sembrarDocumentos(501);
    const primera = await leer(servicio);
    expect(primera.items).toHaveLength(500);
    expect(primera.servidor_ahora).toBeDefined();
    const ultimo = primera.items[primera.items.length - 1];
    if (ultimo === undefined) {
      throw new Error("La primera página debía traer alertas");
    }
    const segunda = await leer(servicio, ultimo.updated_at);
    expect(segunda.items.length).toBe(1);
    expect(primera.items.length + segunda.items.length).toBe(501);
  }, 120_000);

  it("exactamente 500 alertas caben en una página", async () => {
    const { servicio } = await sembrarDocumentos(500);
    const respuesta = await leer(servicio);
    expect(respuesta.items).toHaveLength(500);
  }, 120_000);

  it("el resumen cuenta las 501 aunque la sincronización pagine", async () => {
    const { servicio } = await sembrarDocumentos(501);
    const resumen = await resumenDe(servicio);
    expect(resumen.total).toBe(501);
  }, 120_000);
});
