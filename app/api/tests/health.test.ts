import { afterEach, describe, expect, it, vi } from "vitest";
import { SaludSchema, SERVICIO_API, VERSION_API } from "../../shared/schema";

/**
 * `GET /api/health` es público: no verifica token ni toca Firestore (A0 §4 R7).
 * Se importa el handler real y se controla el entorno con `vi.stubEnv`,
 * sin red ni Firebase.
 */

const ENTORNO_COMPLETO = {
  FIREBASE_PROJECT_ID: "boton-seguridad-test",
  FIREBASE_CLIENT_EMAIL: "servicio@boton-seguridad-test.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----",
  FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
};

type NombreEnvio = keyof typeof ENTORNO_COMPLETO;

const OBLIGATORIAS: NombreEnvio[] = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
];

function peticionSalud() {
  return new Request("http://localhost/api/health", { method: "GET" });
}

/** Importa la ruta fresca tras cambiar el entorno (la validación es perezosa por proceso). */
async function cargarRuta(): Promise<(peticion: Request) => Promise<Response>> {
  vi.resetModules();
  const modulo = await import("../health/route");
  return modulo.GET;
}

async function llamarSalud() {
  const GET = await cargarRuta();
  const respuesta = await GET(peticionSalud());
  const cuerpo = SaludSchema.parse(await respuesta.json());
  return { respuesta, cuerpo };
}

function stubbearEntornoCompleto() {
  for (const nombre of OBLIGATORIAS) {
    vi.stubEnv(nombre, ENTORNO_COMPLETO[nombre]);
  }
}

function stubbearEntornoSinConfigurar() {
  for (const nombre of OBLIGATORIAS) {
    vi.stubEnv(nombre, "");
  }
}

/** Aplica stubs de entorno sin recargar el módulo (misma sesión). */
function stubbearSinRecargar(entrada: Record<string, string>) {
  for (const nombre of OBLIGATORIAS) {
    vi.stubEnv(nombre, entrada[nombre]);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("A0 §8.4 · GET /api/health con entorno completo", () => {
  it("responde 200 con ok, servicio y version del contrato móvil", async () => {
    stubbearEntornoCompleto();
    const { respuesta, cuerpo } = await llamarSalud();
    expect(respuesta.status).toBe(200);
    expect(cuerpo.ok).toBe(true);
    expect(cuerpo.servicio).toBe(SERVICIO_API);
    expect(cuerpo.version).toBe(VERSION_API);
    expect(cuerpo.version).toBe("0.1.0");
  });

  it("la respuesta real valida con SaludSchema y lleva JSON con solo los campos del contrato", async () => {
    stubbearEntornoCompleto();
    const GET = await cargarRuta();
    const respuesta = await GET(peticionSalud());
    expect(respuesta.headers.get("content-type") ?? "").toContain("application/json");
    const cuerpo = SaludSchema.parse(await respuesta.json());
    expect(Object.keys(cuerpo).sort()).toEqual(["ok", "servicio", "version"]);
  });
});

describe("A0 §8.5 · GET /api/health sin entorno", () => {
  it("responde 200 con ok false y el servicio identificado cuando falta entorno", async () => {
    stubbearEntornoSinConfigurar();
    const { respuesta, cuerpo } = await llamarSalud();
    expect(respuesta.status).toBe(200);
    expect(cuerpo.ok).toBe(false);
    expect(cuerpo.servicio).toBe(SERVICIO_API);
  });

  it("la respuesta sin entorno también valida con SaludSchema", async () => {
    stubbearEntornoSinConfigurar();
    const { cuerpo } = await llamarSalud();
    expect(() => SaludSchema.parse(cuerpo)).not.toThrow();
  });

  it("no es 500: el proceso está vivo aunque falte configuración", async () => {
    stubbearEntornoSinConfigurar();
    const { respuesta } = await llamarSalud();
    expect(respuesta.status).not.toBe(500);
  });
});

describe("A0 §5 y §8.4 · health es público", () => {
  it("no requiere Authorization", async () => {
    stubbearEntornoCompleto();
    const { respuesta } = await llamarSalud();
    expect(respuesta.status).toBe(200);
  });

  it("un Authorization inválido no lo convierte en 401", async () => {
    stubbearEntornoCompleto();
    const GET = await cargarRuta();
    const peticion = new Request("http://localhost/api/health", {
      headers: { authorization: "Basic x" },
    });
    const respuesta = await GET(peticion);
    expect(respuesta.status).toBe(200);
  });
});

describe("corrección seguridad A0 · la salud se calcula en cada llamada (force-dynamic)", () => {
  it("exporta dynamic = 'force-dynamic' y runtime = 'nodejs'", async () => {
    vi.resetModules();
    const modulo = await import("../health/route");
    expect(modulo.dynamic).toBe("force-dynamic");
    expect(modulo.runtime).toBe("nodejs");
  });

  it("en la MISMA sesión de módulo: entorno vacío → sin_entorno, luego completo → listo", async () => {
    // 1) Una sola carga del módulo.
    vi.resetModules();
    stubbearSinRecargar({
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
      FIREBASE_WEB_API_KEY: "",
    });
    const modulo = await import("../health/route");
    const sinEntorno = SaludSchema.parse(await (await modulo.GET(peticionSalud())).json());
    expect(sinEntorno.servicio).toBe(SERVICIO_API);
    expect(sinEntorno.ok).toBe(false);

    // 2) Cambia el entorno del proceso SIN recargar el módulo.
    stubbearSinRecargar(ENTORNO_COMPLETO);
    const conEntorno = SaludSchema.parse(await (await modulo.GET(peticionSalud())).json());
    expect(conEntorno.servicio).toBe(SERVICIO_API);
    expect(conEntorno.ok).toBe(true);
  });

  it("el handler directo no expone x-powered-by y marca la respuesta como no-store", async () => {
    stubbearEntornoCompleto();
    const GET = await cargarRuta();
    const respuesta = await GET(peticionSalud());

    expect(respuesta.headers.get("x-powered-by")).toBeNull();
    expect(respuesta.headers.get("cache-control") ?? "").toContain("no-store");
  });
});

describe("corrección seguridad A0 · cabeceras de seguridad en la configuración de Next", () => {
  it("next.config.ts cubre /api/health con nosniff y no-referrer y oculta x-powered-by", async () => {
    const nextConfig = (await import("../../../next.config")).default;
    expect(nextConfig.poweredByHeader).toBe(false);

    const reglas = (await nextConfig.headers?.()) ?? [];
    expect(reglas.length).toBeGreaterThan(0);

    // La entrada que cubre `/api/health` es la del comodín `/:ruta*`.
    const regla = reglas.find((entrada) => entrada.source === "/:ruta*");
    expect(regla).toBeDefined();
    expect(regla?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ]),
    );
  });
});
