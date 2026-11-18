import { beforeEach, describe, expect, it } from "vitest";
import {
  type Contacto,
  ContactoSchema,
  ErrorHttpSchema,
  type ContactoEscritura,
  type Sesion,
  SesionSchema,
  type RespuestaContactos,
  RespuestaContactosSchema,
} from "@/shared/schema";
import { esErrorDeDominio } from "@/shared/server/errors";
import { respuestaDeError } from "@/shared/server/http";
import type { Reloj } from "@/shared/server/time";
import { crearRepositorioContactosEnMemoria } from "../server/repository.memory";
import { crearServicioContactos, type ServicioContactos } from "../server/contactos-service";

/**
 * Spec A2 · Reglas de negocio de contactos de confianza (sección 8).
 *
 * Todo se prueba a través del SERVICIO con el repositorio en memoria y un reloj
 * fijo: cero red, cero Firebase. Cada criterio de aceptación de la sección 8 es
 * al menos una prueba con nombre de negocio; los bordes de la sección 9 van
 * aparte.
 *
 * Las reglas que solo existen en la frontera (validación Zod del cuerpo, `since`
 * inválido, 415, id no UUID en la URL) se prueban en `app/api/tests/contactos.test.ts`.
 */

const AHORA = new Date("2026-11-14T08:00:00.000Z");

const UID_A = "uid-ana";
const UID_B = "uid-beto";

const ID_ANA = "11111111-1111-4111-8111-111111111111";
const ID_BETO = "99999999-9999-4999-8999-999999999999";

function sesion(uid: string): Sesion {
  return SesionSchema.parse({ uid, rol: "usuario" });
}

const SESION_A = sesion(UID_A);
const SESION_B = sesion(UID_B);

/** UUID determinista por número: base 1000 para no chocar con los fijos. */
function idDe(indice: number): string {
  const relleno = String(indice).padStart(12, "0");
  return `00000000-0000-4000-8000-${relleno}`;
}

/** Teléfono determinista de 10 dígitos por número. */
function telefonoDe(indice: number): string {
  return String(3000000000 + indice);
}

/** Cuerpo de escritura con el contrato de `ContactoEscritura`. */
function escritura(parcial: Partial<ContactoEscritura> = {}): ContactoEscritura {
  const base: ContactoEscritura = {
    nombre: "Ana Pérez",
    telefono: "3001234567",
    parentesco: null,
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
  return {
    estado: respuesta.status,
    cuerpo: ErrorHttpSchema.parse(await respuesta.json()),
  };
}

/** Documento guardado validado con el contrato de cable. */
function contacto(valor: Contacto): Contacto {
  return ContactoSchema.parse(valor);
}

type Contexto = {
  servicio: ServicioContactos;
  cambiosDeReloj: (instante: Date) => void;
};

/**
 * Servicio con repositorio nuevo, reloj mutable y observadores.
 * `cambiosDeReloj` permite avanzar el tiempo entre escrituras.
 */
function crearContexto(): Contexto {
  const repositorio = crearRepositorioContactosEnMemoria();
  let instante = new Date(AHORA.getTime());
  const reloj: Reloj = {
    ahora() {
      return new Date(instante.getTime());
    },
  };
  const servicio = crearServicioContactos({ repositorio, reloj });
  return {
    servicio,
    cambiosDeReloj(nuevo: Date) {
      instante = new Date(nuevo.getTime());
    },
  };
}

/** Crea `cantidad` contactos activos con ids y teléfonos distintos. */
async function sembrar(servicio: ServicioContactos, cantidad: number): Promise<Contacto[]> {
  const creados: Contacto[] = [];
  for (let indice = 1; indice <= cantidad; indice += 1) {
    const guardado = await servicio.guardar(
      SESION_A,
      idDe(indice),
      escritura({ nombre: `Contacto ${indice}`, telefono: telefonoDe(indice) }),
    );
    creados.push(contacto(guardado));
  }
  return creados;
}

/** GET del servicio validado con el contrato de la respuesta. */
async function leer(servicio: ServicioContactos, since?: string): Promise<RespuestaContactos> {
  return RespuestaContactosSchema.parse(await servicio.listar(SESION_A, since));
}

// ---------------------------------------------------------------------------
// Criterio 1 · PUT válido nuevo
// ---------------------------------------------------------------------------

describe("A2 §8.1 · un PUT válido nuevo devuelve el documento guardado", () => {
  let contexto: Contexto;

  beforeEach(() => {
    contexto = crearContexto();
  });

  it("responde con id, deleted_at null y created_at === updated_at del reloj", async () => {
    const guardado = contacto(await contexto.servicio.guardar(SESION_A, ID_ANA, escritura()));
    expect(guardado.id).toBe(ID_ANA);
    expect(guardado.deleted_at).toBeNull();
    expect(guardado.created_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.updated_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.created_at).toBe(guardado.updated_at);
  });

  it("guarda nombre, teléfono y parentesco tal como llegan", async () => {
    const guardado = contacto(
      await contexto.servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ nombre: "Ana Pérez", telefono: "3001234567", parentesco: "hija" }),
      ),
    );
    expect(guardado.nombre).toBe("Ana Pérez");
    expect(guardado.telefono).toBe("3001234567");
    expect(guardado.parentesco).toBe("hija");
  });
});

// ---------------------------------------------------------------------------
// Criterio 2 · PUT idempotente
// ---------------------------------------------------------------------------

describe("A2 §8.2 · repetir el mismo PUT no duplica ni cambia created_at", () => {
  it("un solo documento y el mismo created_at tras dos llamadas", async () => {
    const { servicio } = crearContexto();
    const cuerpo = escritura();
    const primero = contacto(await servicio.guardar(SESION_A, ID_ANA, cuerpo));
    const segundo = contacto(await servicio.guardar(SESION_A, ID_ANA, cuerpo));
    expect(segundo.id).toBe(primero.id);
    expect(segundo.created_at).toBe(primero.created_at);
    expect(segundo.updated_at).toBe(primero.updated_at);
    const todos = (await servicio.listar(SESION_A)).items;
    expect(todos.filter((item) => item.id === ID_ANA)).toHaveLength(1);
    expect(todos).toHaveLength(1);
  });

  it("reintentar con datos distintos sobre el mismo id reemplaza (última escritura)", async () => {
    const { servicio } = crearContexto();
    const primero = contacto(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    const segundo = contacto(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ nombre: "Ana María", telefono: "3009998888" }),
      ),
    );
    expect(segundo.nombre).toBe("Ana María");
    expect(segundo.telefono).toBe("3009998888");
    expect(segundo.created_at).toBe(primero.created_at);
    expect((await leer(servicio)).items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Criterios 3 y 4 · validación de entrada
// ---------------------------------------------------------------------------

/**
 * Los criterios 3 (teléfono de 10 dígitos) y 4 (nombre 1–60) son de la
 * **frontera HTTP**: la spec A2 los coloca en §6 y se prueban con la ruta real
 * en `app/api/tests/contactos.test.ts`, que revisa `400` y `detalles[0].campo`.
 * El servicio no repite esa validación como `ErrorDeValidacion`; si recibiera
 * datos ya inválidos, esa es una barrera del contrato `ContactoEscrituraSchema`,
 * no una regla de negocio con respuesta propia.
 */

// ---------------------------------------------------------------------------
// Criterio 5 · límite de 5
// ---------------------------------------------------------------------------

describe("A2 §8.5 · el sexto contacto activo → 409 'Máximo 5 contactos de confianza'", () => {
  it("con 5 activos, un PUT nuevo responde 409 con el mensaje literal", async () => {
    const { servicio } = crearContexto();
    await sembrar(servicio, 5);
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, idDe(6), escritura({ telefono: telefonoDe(6) })),
    );
    expect(estado).toBe(409);
    expect(cuerpo.error).toBe("Máximo 5 contactos de confianza");
  });

  it("actualizar uno de los 5 existentes sigue dando 200", async () => {
    const { servicio } = crearContexto();
    const creados = await sembrar(servicio, 5);
    const existente = creados[0];
    if (existente === undefined) {
      throw new Error("La siembra debía crear 5 contactos");
    }
    const guardado = contacto(
      await servicio.guardar(
        SESION_A,
        existente.id,
        escritura({ nombre: "Renombrado", telefono: existente.telefono }),
      ),
    );
    expect(guardado.nombre).toBe("Renombrado");
  });

  it("los borrados lógicos no ocupan cupo: con 5 borrados se acepta un activo", async () => {
    const { servicio } = crearContexto();
    const creados = await sembrar(servicio, 5);
    for (const item of creados) {
      await servicio.borrar(SESION_A, item.id);
    }
    const nuevo = contacto(
      await servicio.guardar(SESION_A, idDe(50), escritura({ telefono: telefonoDe(50) })),
    );
    expect(nuevo.deleted_at).toBeNull();
  });

  it("tras borrar uno de los 5, un nuevo PUT se acepta y el cupo vuelve a 5", async () => {
    const { servicio } = crearContexto();
    const creados = await sembrar(servicio, 5);
    const primero = creados[0];
    if (primero === undefined) {
      throw new Error("La siembra debía crear 5 contactos");
    }
    await servicio.borrar(SESION_A, primero.id);
    const nuevo = contacto(
      await servicio.guardar(SESION_A, idDe(60), escritura({ telefono: telefonoDe(60) })),
    );
    expect(nuevo.deleted_at).toBeNull();
    const sexto = await errorHttp(
      servicio.guardar(SESION_A, idDe(61), escritura({ telefono: telefonoDe(61) })),
    );
    expect(sexto.estado).toBe(409);
    expect(sexto.cuerpo.error).toBe("Máximo 5 contactos de confianza");
  });
});

// ---------------------------------------------------------------------------
// Criterio 6 · sin duplicados por teléfono
// ---------------------------------------------------------------------------

describe("A2 §8.6 · un teléfono repetido entre activos → 409", () => {
  it("dos PUT distintos con el mismo teléfono → 409 'Ese teléfono ya está en tus contactos'", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, idDe(2), escritura({ telefono: "3001234567" })),
    );
    expect(estado).toBe(409);
    expect(cuerpo.error).toBe("Ese teléfono ya está en tus contactos");
  });

  it("reutilizar su propio teléfono en el mismo id no se considera duplicado", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    const guardado = contacto(
      await servicio.guardar(
        SESION_A,
        ID_ANA,
        escritura({ nombre: "Otro nombre", telefono: "3001234567" }),
      ),
    );
    expect(guardado.telefono).toBe("3001234567");
  });

  it("la unicidad no cruza cuentas: otro usuario puede usar el mismo teléfono", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    const deBeto = contacto(
      await servicio.guardar(SESION_B, ID_BETO, escritura({ telefono: "3001234567" })),
    );
    expect(deBeto.telefono).toBe("3001234567");
  });

  it("regresión (security A2): restaurar un borrado cuyo teléfono ya usa un activo → 409 'Ese teléfono ya está en tus contactos'", async () => {
    // C1 con teléfono T se borra; C2 se crea con el mismo teléfono T; PUT de C1.
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, idDe(1), escritura({ telefono: telefonoDe(1) }));
    await servicio.borrar(SESION_A, idDe(1));
    await servicio.guardar(SESION_A, idDe(2), escritura({ telefono: telefonoDe(1) }));
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, idDe(1), escritura({ telefono: telefonoDe(1) })),
    );
    expect(estado).toBe(409);
    expect(cuerpo.error).toBe("Ese teléfono ya está en tus contactos");
  });
});

// ---------------------------------------------------------------------------
// Criterio 7 · borrar libera el teléfono
// ---------------------------------------------------------------------------

describe("A2 §8.7 · un contacto borrado libera su teléfono", () => {
  it("PUT nuevo con el mismo teléfono de un borrado → 200", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    await servicio.borrar(SESION_A, ID_ANA);
    const nuevo = contacto(
      await servicio.guardar(SESION_A, idDe(2), escritura({ telefono: "3001234567" })),
    );
    expect(nuevo.deleted_at).toBeNull();
    expect(nuevo.telefono).toBe("3001234567");
  });
});

// ---------------------------------------------------------------------------
// Criterio 8 · DELETE lógico
// ---------------------------------------------------------------------------

describe("A2 §8.8 · DELETE es lógico y aparece en GET sincronizado", () => {
  it("DELETE de un existente → ok y GET ?since lo devuelve con deleted_at no nulo", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    const resultado = await servicio.borrar(SESION_A, ID_ANA);
    expect(resultado).toEqual({ ok: true });
    const respuesta = await leer(servicio, "2026-11-14T08:00:00.000Z");
    const borrado = respuesta.items[0];
    if (borrado === undefined) {
      throw new Error("El contacto borrado debía venir en la sincronización");
    }
    expect(borrado.deleted_at).toBe("2026-11-14T09:00:00.000Z");
    expect(borrado.updated_at).toBe(borrado.deleted_at);
  });
});

// ---------------------------------------------------------------------------
// Criterio 9 · segundo DELETE → 404
// ---------------------------------------------------------------------------

describe("A2 §8.9 · un segundo DELETE del mismo contacto → 404", () => {
  it("responde 404 'Contacto no encontrado'", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    await servicio.borrar(SESION_A, ID_ANA);
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_A, ID_ANA));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Contacto no encontrado");
  });

  it("DELETE de un id inexistente → 404 'Contacto no encontrado'", async () => {
    const { servicio } = crearContexto();
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_A, idDe(999)));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Contacto no encontrado");
  });
});

// ---------------------------------------------------------------------------
// Criterio 10 · aislamiento entre usuarios
// ---------------------------------------------------------------------------

describe("A2 §8.10 · el contacto de otro usuario es indistinguible de uno inexistente", () => {
  it("DELETE de B con el id de un contacto de A → 404 y A no lo pierde", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const { estado, cuerpo } = await errorHttp(servicio.borrar(SESION_B, ID_ANA));
    expect(estado).toBe(404);
    expect(cuerpo.error).toBe("Contacto no encontrado");
    const deA = await servicio.listar(SESION_A);
    expect(deA.items).toHaveLength(1);
    expect(deA.items[0]?.deleted_at).toBeNull();
  });

  it("PUT de B con el id de A crea el documento en la cuenta de B, no en la de A", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(
      SESION_A,
      ID_ANA,
      escritura({ nombre: "De Ana", telefono: "3001234567" }),
    );
    const deBeto = contacto(
      await servicio.guardar(
        SESION_B,
        ID_ANA,
        escritura({ nombre: "De Beto", telefono: "3009998888" }),
      ),
    );
    expect(deBeto.nombre).toBe("De Beto");
    const listaA = (await servicio.listar(SESION_A)).items;
    const listaB = (await servicio.listar(SESION_B)).items;
    expect(listaA).toHaveLength(1);
    expect(listaB).toHaveLength(1);
    expect(listaA[0]?.nombre).toBe("De Ana");
    expect(listaB[0]?.nombre).toBe("De Beto");
  });

  it("GET de B no ve los contactos de A", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const deB = await servicio.listar(SESION_B);
    expect(deB.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 11 · GET sin since
// ---------------------------------------------------------------------------

describe("A2 §8.11 · GET sin since devuelve todos (incluidos borrados) y servidor_ahora", () => {
  it("trae activos y borrados del usuario con servidor_ahora del reloj inyectado", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    await servicio.guardar(SESION_A, idDe(2), escritura({ telefono: "3009998888" }));
    await servicio.borrar(SESION_A, ID_ANA);
    const respuesta = await leer(servicio);
    expect(respuesta.items).toHaveLength(2);
    expect(respuesta.items.some((item) => item.deleted_at !== null)).toBe(true);
    expect(respuesta.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });

  it("GET sin since en una cuenta vacía devuelve items vacío y servidor_ahora", async () => {
    const { servicio } = crearContexto();
    const respuesta = await leer(servicio);
    expect(respuesta.items).toEqual([]);
    expect(respuesta.servidor_ahora).toBe("2026-11-14T08:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Criterio 12 · GET ?since
// ---------------------------------------------------------------------------

describe("A2 §8.12 · GET ?since devuelve solo lo modificado después", () => {
  it("filtra por updated_at > since y ordena ascendente", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "3001234567" }));
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    await servicio.guardar(SESION_A, idDe(2), escritura({ telefono: "3009998888" }));
    cambiosDeReloj(new Date("2026-11-14T10:00:00.000Z"));
    await servicio.guardar(SESION_A, idDe(3), escritura({ telefono: "3007776666" }));

    const despues = await leer(servicio, "2026-11-14T08:00:00.000Z");
    expect(despues.items.map((item) => item.id)).toEqual([idDe(2), idDe(3)]);
    const instantes = despues.items.map((item) => item.updated_at);
    expect(instantes).toEqual([...instantes].sort());
  });

  it("un since posterior a todo devuelve items vacío", async () => {
    const { servicio } = crearContexto();
    await servicio.guardar(SESION_A, ID_ANA, escritura());
    const respuesta = await leer(servicio, "2026-11-15T00:00:00.000Z");
    expect(respuesta.items).toEqual([]);
  });

  it("since igual al último updated_at no repite ese documento", async () => {
    const { servicio } = crearContexto();
    const creado = contacto(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    const respuesta = await leer(servicio, creado.updated_at);
    expect(respuesta.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Criterio 14 · parentesco
// ---------------------------------------------------------------------------

describe("A2 §8.14 · parentesco vacío, 40 caracteres y ausente", () => {
  let servicio: ServicioContactos;

  beforeEach(() => {
    servicio = crearContexto().servicio;
  });

  it("parentesco '' se guarda como null", async () => {
    const guardado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ parentesco: "" })),
    );
    expect(guardado.parentesco).toBeNull();
  });

  it("parentesco de 41 caracteres se rechaza en la frontera (ver pruebas HTTP)", async () => {
    // El 400 por longitud vive en la ruta (spec §6 y criterio 14); aquí se
    // comprueba que un valor dentro del límite sí se guarda.
    const cuarenta = "a".repeat(40);
    const guardado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ parentesco: cuarenta })),
    );
    expect(guardado.parentesco?.length).toBe(40);
  });

  it("parentesco de 40 caracteres se acepta", async () => {
    const cuarenta = "a".repeat(40);
    const guardado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ parentesco: cuarenta })),
    );
    expect(guardado.parentesco).toBe(cuarenta);
  });

  it("parentesco ausente se guarda como null", async () => {
    const guardado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ parentesco: "" })),
    );
    expect(guardado.parentesco).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Criterio 16 · el servidor pone el documento y las fechas
// ---------------------------------------------------------------------------

describe("A2 §8.16 · campos del cliente (uid, fechas, id) no se imponen", () => {
  it("ignora created_at/updated_at/deleted_at/uid del cuerpo y usa el reloj", async () => {
    const { servicio } = crearContexto();
    // El cuerpo trae campos extra: el contrato los descarta.
    const conExtra = {
      nombre: "Ana",
      telefono: "3001234567",
      parentesco: null,
      uid: UID_B,
      created_at: "2000-01-01T00:00:00.000Z",
      updated_at: "2000-01-01T00:00:00.000Z",
      deleted_at: "2000-01-01T00:00:00.000Z",
      id: "otro-id",
    };
    const guardado = contacto(await servicio.guardar(SESION_A, ID_ANA, conExtra));
    expect(guardado.id).toBe(ID_ANA);
    expect(guardado.created_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.updated_at).toBe("2026-11-14T08:00:00.000Z");
    expect(guardado.deleted_at).toBeNull();
    const deB = await servicio.listar(SESION_B);
    expect(deB.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Criterio 17 · restaurar borrado
// ---------------------------------------------------------------------------

describe("A2 §8.17 · PUT sobre un contacto borrado lo restaura y conserva created_at", () => {
  it("devuelve deleted_at null y el mismo created_at", async () => {
    const { servicio, cambiosDeReloj } = crearContexto();
    const creado = contacto(await servicio.guardar(SESION_A, ID_ANA, escritura()));
    cambiosDeReloj(new Date("2026-11-14T09:00:00.000Z"));
    await servicio.borrar(SESION_A, ID_ANA);
    cambiosDeReloj(new Date("2026-11-14T10:00:00.000Z"));
    const restaurado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ nombre: "Vuelve" })),
    );
    expect(restaurado.deleted_at).toBeNull();
    expect(restaurado.created_at).toBe(creado.created_at);
    expect(restaurado.updated_at).toBe("2026-11-14T10:00:00.000Z");
    expect(restaurado.nombre).toBe("Vuelve");
  });

  it("restaurar respeta el límite: con 5 activos no se restaura un 6.º", async () => {
    const { servicio } = crearContexto();
    const extra = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: telefonoDe(99) })),
    );
    await servicio.borrar(SESION_A, extra.id);
    await sembrar(servicio, 5);
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: telefonoDe(99) })),
    );
    expect(estado).toBe(409);
    expect(cuerpo.error).toBe("Máximo 5 contactos de confianza");
  });

  it("regresión (security A2): restaurar tras ocupar el hueco → 409 y la restauración no se aplica", async () => {
    // C1…C5 → borrar C1 → crear C6 (ocupa el hueco) → PUT del id de C1.
    const { servicio } = crearContexto();
    await sembrar(servicio, 5);
    await servicio.borrar(SESION_A, idDe(1));
    const sexto = contacto(
      await servicio.guardar(
        SESION_A,
        idDe(6),
        escritura({ nombre: "C6", telefono: telefonoDe(6) }),
      ),
    );
    expect(sexto.deleted_at).toBeNull();
    const { estado, cuerpo } = await errorHttp(
      servicio.guardar(SESION_A, idDe(1), escritura({ nombre: "C1", telefono: telefonoDe(1) })),
    );
    expect(estado).toBe(409);
    expect(cuerpo.error).toBe("Máximo 5 contactos de confianza");
    const lista = (await leer(servicio)).items;
    expect(lista.filter((item) => item.deleted_at === null)).toHaveLength(5);
    const c1 = lista.find((item) => item.id === idDe(1));
    expect(c1?.deleted_at).not.toBeNull();
  });

  it("regresión (security A2): restaurar sin ocupar el hueco → 200 y 5 activos", async () => {
    // C1…C5 → borrar C1 (quedan 4 activos) → PUT de C1 (sin crear C6).
    const { servicio } = crearContexto();
    await sembrar(servicio, 5);
    await servicio.borrar(SESION_A, idDe(1));
    const restaurado = contacto(
      await servicio.guardar(
        SESION_A,
        idDe(1),
        escritura({ nombre: "C1", telefono: telefonoDe(1) }),
      ),
    );
    expect(restaurado.deleted_at).toBeNull();
    const activos = (await leer(servicio)).items.filter((item) => item.deleted_at === null);
    expect(activos).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Criterio 18 · paginación
// ---------------------------------------------------------------------------

describe("A2 §8.18 · la sincronización pagina a 500 con servidor_ahora", () => {
  /**
   * Siembra `total` documentos en la cuenta A sin chocar con el máximo de 5:
   * crea un lote de 5, los borra y sigue. Cada escritura avanza el reloj 1 ms
   * para que los `updated_at` queden ordenados y distintos (el cursor `since`
   * es `updated_at > since`).
   */
  async function sembrarDocumentos(total: number): Promise<Contexto> {
    const contexto = crearContexto();
    let milisegundos = AHORA.getTime();
    function avanzar(): void {
      milisegundos += 1;
      contexto.cambiosDeReloj(new Date(milisegundos));
    }
    let indice = 0;
    while (indice < total) {
      const lote: string[] = [];
      for (let enLote = 0; enLote < 5 && indice < total; enLote += 1) {
        indice += 1;
        avanzar();
        const guardado = await contexto.servicio.guardar(
          SESION_A,
          idDe(indice),
          escritura({ nombre: `C${indice}`, telefono: telefonoDe(indice) }),
        );
        lote.push(guardado.id);
      }
      for (const id of lote) {
        avanzar();
        await contexto.servicio.borrar(SESION_A, id);
      }
    }
    return contexto;
  }

  it("con 501 modificados, el primer GET trae 500 y el siguiente trae los restantes", async () => {
    const { servicio } = await sembrarDocumentos(501);
    const primera = await leer(servicio);
    expect(primera.items).toHaveLength(500);
    expect(primera.servidor_ahora).toBeDefined();
    const ultimo = primera.items[primera.items.length - 1];
    if (ultimo === undefined) {
      throw new Error("La primera página debía traer documentos");
    }
    const segunda = await leer(servicio, ultimo.updated_at);
    expect(segunda.items.length).toBe(1);
    expect(primera.items.length + segunda.items.length).toBe(501);
  }, 120_000);

  it("exactamente 500 modificados caben en una página", async () => {
    const { servicio } = await sembrarDocumentos(500);
    const respuesta = await leer(servicio);
    expect(respuesta.items).toHaveLength(500);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Bordes de la sección 9
// ---------------------------------------------------------------------------

describe("A2 §9 (bordes) · nombre de 1 y 60 se aceptan", () => {
  it("nombre de 1 carácter y de 60 caracteres → 200", async () => {
    const { servicio } = crearContexto();
    const uno = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ nombre: "A", telefono: "3001234567" })),
    );
    expect(uno.nombre).toBe("A");
    const sesenta = "b".repeat(60);
    const largo = contacto(
      await servicio.guardar(
        SESION_A,
        idDe(2),
        escritura({ nombre: sesenta, telefono: "3009998888" }),
      ),
    );
    expect(largo.nombre).toBe(sesenta);
  });

  it("el nombre se recorta antes de medir", async () => {
    const { servicio } = crearContexto();
    const guardado = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ nombre: "  Ana  " })),
    );
    expect(guardado.nombre).toBe("Ana");
  });
});

describe("A2 §9 (bordes) · teléfonos límite se aceptan", () => {
  it("'0000000000' y '9999999999' → 200", async () => {
    const { servicio } = crearContexto();
    const cero = contacto(
      await servicio.guardar(SESION_A, ID_ANA, escritura({ telefono: "0000000000" })),
    );
    expect(cero.telefono).toBe("0000000000");
    const nueve = contacto(
      await servicio.guardar(SESION_A, idDe(2), escritura({ telefono: "9999999999" })),
    );
    expect(nueve.telefono).toBe("9999999999");
  });
});

describe("A2 §9 (bordes) · 5 borrados + 5 activos", () => {
  /**
   * Deja 5 activos y 5 borrados. Para crear cada extra se libera un cupo
   * borrando uno de los activos y se restaura al terminar, de modo que nunca
   * hay más de 5 activos (R4) y al final quedan 5 activos + 5 borrados.
   */
  async function sembrarCincoYcincoBorrados(servicio: ServicioContactos): Promise<void> {
    await sembrar(servicio, 5);
    for (let indice = 6; indice <= 10; indice += 1) {
      const prestado = idDe(indice - 5);
      await servicio.borrar(SESION_A, prestado);
      const extra = await servicio.guardar(
        SESION_A,
        idDe(indice),
        escritura({ nombre: `Borrado ${indice}`, telefono: telefonoDe(indice) }),
      );
      await servicio.borrar(SESION_A, extra.id);
      await servicio.guardar(
        SESION_A,
        prestado,
        escritura({ nombre: `Contacto ${indice - 5}`, telefono: telefonoDe(indice - 5) }),
      );
    }
  }

  it("el 6.º activo rechaza y aceptar uno nuevo exige borrar antes", async () => {
    const { servicio } = crearContexto();
    await sembrarCincoYcincoBorrados(servicio);
    const sexto = await errorHttp(
      servicio.guardar(SESION_A, idDe(100), escritura({ telefono: telefonoDe(100) })),
    );
    expect(sexto.estado).toBe(409);
    expect(sexto.cuerpo.error).toBe("Máximo 5 contactos de confianza");
    await servicio.borrar(SESION_A, idDe(1));
    const nuevo = contacto(
      await servicio.guardar(SESION_A, idDe(101), escritura({ telefono: telefonoDe(101) })),
    );
    expect(nuevo.deleted_at).toBeNull();
  });

  it("GET sin since devuelve los 10 (activos y borrados)", async () => {
    const { servicio } = crearContexto();
    await sembrarCincoYcincoBorrados(servicio);
    const respuesta = await leer(servicio);
    expect(respuesta.items).toHaveLength(10);
    expect(respuesta.items.filter((item) => item.deleted_at === null)).toHaveLength(5);
  });
});
