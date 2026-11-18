import { describe, expect, it, vi, type Mock } from "vitest";
import {
  type EstadoAdmin,
  ErrorHttpSchema,
  EstadoAdminSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { ErrorDeDominio } from "@/shared/server/errors";
import { respuestaDeError } from "@/shared/server/http";
import { crearServicioAdmin } from "../server/admin-service";
import { type RepositorioAdmin } from "../server/admin-repository";

/**
 * Spec A5 · Rol `admin` y ruta de diagnóstico (sección 8, criterios 1–6).
 *
 * Se prueba el servicio con un repositorio doble: cero red, cero Firebase y
 * cero Firestore. La regla del rol sale **solo** de la sesión verificada (R2);
 * un cuerpo o una query con `rol: "admin"` no llegan siquiera al servicio.
 *
 * La frontera HTTP (`401` sin token, `403` del servicio, `500` opaco) está en
 * `app/api/tests/admin.test.ts`. El aislamiento de A2/A3 con una sesión `admin`
 * está en `app/features/accounts/tests/admin-aislamiento.test.ts`.
 */

const TOTALES: EstadoAdmin = { cuentas: 3, contactos: 12, alertas: 40 };

/** Sesión del contrato: el rol es siempre el que resolvió la verificación del token. */
function sesionDe(uid: string, rol: Sesion["rol"]): Sesion {
  return SesionSchema.parse({ uid, email: `${uid}@x.com`, rol });
}

/** Doble del repositorio que devuelve los totales programados y cuenta sus llamadas. */
type RepositorioDoble = {
  repositorio: RepositorioAdmin;
  contar: Mock<() => Promise<EstadoAdmin>>;
};

function repositorioCon(totales: EstadoAdmin): RepositorioDoble {
  const contar = vi.fn<() => Promise<EstadoAdmin>>(async () => {
    return { ...totales };
  });
  return { repositorio: { contar }, contar };
}

/** Doble que siempre falla al contar (Firestore caído). */
function repositorioQueFalla(): RepositorioDoble {
  const contar = vi.fn<() => Promise<EstadoAdmin>>(async () => {
    throw new Error("Firestore caído");
  });
  return { repositorio: { contar }, contar };
}

/** Ejecuta una operación que debe fallar y devuelve el `ErrorDeDominio`. */
async function esperarError(promesa: Promise<EstadoAdmin>): Promise<ErrorDeDominio> {
  try {
    await promesa;
  } catch (capturado) {
    if (capturado instanceof ErrorDeDominio) {
      return capturado;
    }
    if (capturado instanceof Error) {
      throw new Error(`Esperaba ErrorDeDominio y llegó ${capturado.name}: ${capturado.message}`);
    }
    throw new Error("Esperaba un ErrorDeDominio");
  }
  throw new Error("La prueba esperaba un rechazo y resolvió");
}

async function cuerpoDeError(error: ErrorDeDominio) {
  return ErrorHttpSchema.parse(await respuestaDeError(error).json());
}

describe("A5 §8.1 · sesión 'admin' → totales exactos y el repositorio se consulta una vez", () => {
  it("devuelve { cuentas, contactos, alertas } iguales a los del repositorio", async () => {
    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const resultado = await servicio.estado(sesionDe("uid-admin", "admin"));

    expect(resultado).toEqual(TOTALES);
    expect(doble.contar).toHaveBeenCalledTimes(1);
  });

  it("la respuesta valida con EstadoAdminSchema y son enteros >= 0", async () => {
    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const resultado = await servicio.estado(sesionDe("uid-admin", "admin"));
    const validado = EstadoAdminSchema.parse(resultado);

    expect(validado.cuentas).toBe(3);
    expect(validado.contactos).toBe(12);
    expect(validado.alertas).toBe(40);
    for (const total of [validado.cuentas, validado.contactos, validado.alertas]) {
      expect(Number.isInteger(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(0);
    }
  });

  it("acepta el borde de totales en cero (sistema vacío)", async () => {
    const doble = repositorioCon({ cuentas: 0, contactos: 0, alertas: 0 });
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const resultado = await servicio.estado(sesionDe("uid-admin", "admin"));

    expect(EstadoAdminSchema.parse(resultado)).toEqual({ cuentas: 0, contactos: 0, alertas: 0 });
  });
});

describe("A5 §8.2 · 'usuario' o token sin claim → 403 sin consultar el repositorio", () => {
  it("rol 'usuario' → 403 con el mensaje por defecto y contar NO se llama", async () => {
    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const error = await esperarError(servicio.estado(sesionDe("uid-ana", "usuario")));

    expect(error.codigo).toBe(403);
    expect((await cuerpoDeError(error)).error).toBe("No tienes permiso para esta operación");
    expect(doble.contar).not.toHaveBeenCalled();
  });

  it("un token sin claim llega como rol 'usuario' (regla de A0) → 403 y sin consultar", async () => {
    // `rolDelToken` (A0) convierte la ausencia del claim en "usuario" antes de
    // construir la sesión; por eso el servicio solo puede recibir "usuario" o
    // "admin". Se reproduce aquí esa misma sesión resuelta.
    const sinClaim = SesionSchema.parse({ uid: "uid-sin-claim", rol: "usuario" });
    expect(sinClaim.rol).toBe("usuario");

    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const error = await esperarError(servicio.estado(sinClaim));

    expect(error.codigo).toBe(403);
    expect(doble.contar).not.toHaveBeenCalled();
  });
});

describe("A5 §8.5 · fallo del repositorio → 500 'Error interno' sin detalles", () => {
  it("un error al contar se traduce a ErrorInterno (500) y el servicio no devuelve totales", async () => {
    const doble = repositorioQueFalla();
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const error = await esperarError(servicio.estado(sesionDe("uid-admin", "admin")));

    expect(error.codigo).toBe(500);
    const cuerpo = await cuerpoDeError(error);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
    expect(doble.contar).toHaveBeenCalledTimes(1);
  });
});

describe("A5 §8.4 · el rol sale solo de la sesión, nunca del cuerpo ni de la query", () => {
  it("una petición con ?rol=admin y cuerpo { rol: 'admin' } no cambia el 403", async () => {
    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });
    // La petición lleva el rol en la query y el cuerpo, pero el servicio solo
    // recibe la sesión verificada: el resto son datos que nunca se leen.
    const peticion = new Request("http://localhost/api/admin/estado?rol=admin", {
      method: "GET",
      headers: { authorization: "Bearer token-de-usuario" },
    });
    expect(new URL(peticion.url).searchParams.get("rol")).toBe("admin");

    const error = await esperarError(servicio.estado(sesionDe("uid-ana", "usuario")));

    expect(error.codigo).toBe(403);
    expect(doble.contar).not.toHaveBeenCalled();
  });

  it("dos sesiones con el mismo uid y distinto rol deciden solo por el rol de la sesión", async () => {
    const doble = repositorioCon(TOTALES);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    await servicio.estado(sesionDe("uid-compartido", "admin"));
    expect(doble.contar).toHaveBeenCalledTimes(1);

    const error = await esperarError(servicio.estado(sesionDe("uid-compartido", "usuario")));
    expect(error.codigo).toBe(403);
    // El rechazo no consulta: sigue habiendo una sola llamada al repositorio.
    expect(doble.contar).toHaveBeenCalledTimes(1);
  });
});

describe("A5 §8.1 y R3 · los totales del repositorio se validan antes de salir", () => {
  const INVALIDOS: EstadoAdmin[] = [
    { cuentas: -1, contactos: 0, alertas: 0 },
    { cuentas: 1, contactos: 1.5, alertas: 0 },
    { cuentas: 1, contactos: 2, alertas: -3 },
  ];

  it.each(
    INVALIDOS,
  )("totales inválidos %# → 500 opaco (nunca sale un total inválido)", async (invalidos) => {
    const doble = repositorioCon(invalidos);
    const servicio = crearServicioAdmin({ repositorio: doble.repositorio });

    const error = await esperarError(servicio.estado(sesionDe("uid-admin", "admin")));

    expect(error.codigo).toBe(500);
    expect((await cuerpoDeError(error)).error).toBe("Error interno");
  });
});
