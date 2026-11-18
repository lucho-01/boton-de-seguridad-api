import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../server/errors";
import {
  evaluarEntorno,
  interpretarOrigenes,
  normalizarClavePrivada,
  validarEntorno,
} from "../server/env";

/**
 * El entorno se inyecta como objeto: la función es pura y no lee `process.env`
 * ni `.env`. Solo devuelve estados, nunca valores.
 */

const ENTORNO_COMPLETO = {
  FIREBASE_PROJECT_ID: "boton-seguridad-test",
  FIREBASE_CLIENT_EMAIL: "servicio@boton-seguridad-test.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
  FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
};

const OBLIGATORIAS = [
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_WEB_API_KEY",
] as const;

const ESTADOS_VALIDOS = ["presente", "falta", "vacía"];

describe("A0 §8.11 · evaluarEntorno clasifica presente / vacía / falta", () => {
  it("con todas las variables completas devuelve 'presente' en cada una", () => {
    const evaluacion = evaluarEntorno({ ...ENTORNO_COMPLETO });
    for (const nombre of OBLIGATORIAS) {
      expect(evaluacion.variables[nombre], nombre).toBe("presente");
    }
    expect(evaluacion.estaCompleto).toBe(true);
    expect(evaluacion.faltantes).toEqual([]);
  });

  it("con variables presentes pero vacías devuelve 'vacía' en cada una", () => {
    const evaluacion = evaluarEntorno({
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
      FIREBASE_WEB_API_KEY: "",
    });
    for (const nombre of OBLIGATORIAS) {
      expect(evaluacion.variables[nombre], nombre).toBe("vacía");
    }
    expect(evaluacion.estaCompleto).toBe(false);
  });

  it("con variables ausentes devuelve 'falta' en cada una", () => {
    const evaluacion = evaluarEntorno({});
    for (const nombre of OBLIGATORIAS) {
      expect(evaluacion.variables[nombre], nombre).toBe("falta");
    }
    expect(evaluacion.faltantes).toEqual([
      "FIREBASE_PROJECT_ID",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
      "FIREBASE_WEB_API_KEY",
    ]);
  });

  it("no muta el arreglo `faltantes` (compara sin sort destructivo)", () => {
    const evaluacion = evaluarEntorno({});
    const antes = [...evaluacion.faltantes];
    void evaluacion.faltantes.toSorted();
    expect(evaluacion.faltantes).toEqual(antes);
    expect(evaluacion.faltantes).toEqual([...OBLIGATORIAS]);
  });

  it("'falta' (ausente) y 'vacía' (definida sin contenido) no se confunden", () => {
    const ausente = evaluarEntorno({});
    const vacio = evaluarEntorno({
      FIREBASE_PROJECT_ID: "",
      FIREBASE_CLIENT_EMAIL: "",
      FIREBASE_PRIVATE_KEY: "",
      FIREBASE_WEB_API_KEY: "",
    });
    expect(ausente.variables.FIREBASE_PROJECT_ID).toBe("falta");
    expect(vacio.variables.FIREBASE_PROJECT_ID).toBe("vacía");
  });

  it("un valor solo con espacios cuenta como vacío", () => {
    const evaluacion = evaluarEntorno({ ...ENTORNO_COMPLETO, FIREBASE_PROJECT_ID: "   " });
    expect(evaluacion.variables.FIREBASE_PROJECT_ID).toBe("vacía");
    expect(evaluacion.estaCompleto).toBe(false);
  });

  it("una variable ausente no impide ver las demás como presentes", () => {
    const evaluacion = evaluarEntorno({
      FIREBASE_PROJECT_ID: "x",
      FIREBASE_CLIENT_EMAIL: "y@x.com",
      FIREBASE_PRIVATE_KEY: "clave",
    });
    expect(evaluacion.variables.FIREBASE_PROJECT_ID).toBe("presente");
    expect(evaluacion.variables.FIREBASE_WEB_API_KEY).toBe("falta");
    expect(evaluacion.faltantes).toEqual(["FIREBASE_WEB_API_KEY"]);
  });
});

describe("A0 §8.10 · la evaluación nunca devuelve valores", () => {
  const SECRETO = "valor-secretisimo-que-no-debe-salir";

  it("evaluarEntorno no expone ningún valor del entorno", () => {
    const evaluacion = evaluarEntorno({
      FIREBASE_PROJECT_ID: SECRETO,
      FIREBASE_CLIENT_EMAIL: SECRETO,
      FIREBASE_PRIVATE_KEY: SECRETO,
      FIREBASE_WEB_API_KEY: SECRETO,
      CORS_ORIGINS: SECRETO,
    });
    expect(JSON.stringify(evaluacion)).not.toContain(SECRETO);
    for (const valor of Object.values(evaluacion.variables)) {
      expect(ESTADOS_VALIDOS).toContain(valor);
    }
  });

  it("normalizarClavePrivada convierte \\n literales en saltos reales", () => {
    const claveConEscapes = "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----";
    const normalizada = normalizarClavePrivada(claveConEscapes);
    expect(normalizada).toBe("-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----");
    expect(normalizada).not.toContain("\\n");
    expect(normalizada.split("\n")).toHaveLength(3);
  });

  it("validarEntorno entrega la clave privada ya normalizada", () => {
    const entorno = validarEntorno({
      ...ENTORNO_COMPLETO,
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----",
    });
    expect(entorno.FIREBASE_PRIVATE_KEY).not.toContain("\\n");
    expect(entorno.FIREBASE_PRIVATE_KEY).toContain("\n");
  });

  it("validarEntorno nombra lo que falta sin incluir el valor", () => {
    let mensaje = "";
    try {
      validarEntorno({ ...ENTORNO_COMPLETO, FIREBASE_WEB_API_KEY: "" });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new Error("La prueba esperaba un Error");
      }
      mensaje = error.message;
    }
    expect(mensaje).toContain("FIREBASE_WEB_API_KEY");
    expect(mensaje).not.toContain(ENTORNO_COMPLETO.FIREBASE_PROJECT_ID);
  });
});

describe("A0 §4 R6 · CORS_ORIGINS es opcional y se interpreta como lista", () => {
  it("lista separada por comas sin espacios", () => {
    expect(interpretarOrigenes("https://a.com,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("CORS_ORIGINS=' ' produce una lista vacía (borde)", () => {
    expect(interpretarOrigenes(" ")).toEqual([]);
  });

  it("lista vacía produce una lista vacía", () => {
    expect(interpretarOrigenes("")).toEqual([]);
  });

  it("ignora entradas vacías entre comas", () => {
    expect(interpretarOrigenes("https://a.com, ,https://b.com")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
  });

  it("CORS_ORIGINS no es obligatoria: el entorno completo no la cuenta como faltante", () => {
    const evaluacion = evaluarEntorno({ ...ENTORNO_COMPLETO });
    expect(evaluacion.estaCompleto).toBe(true);
    expect(evaluacion.faltantes).not.toContain("CORS_ORIGINS");
  });

  it("validarEntorno sin CORS_ORIGINS produce una lista vacía", () => {
    const entorno = validarEntorno({ ...ENTORNO_COMPLETO });
    expect(entorno.CORS_ORIGINS).toEqual([]);
  });
});

describe("A0 §4 R5 · validarEntorno valida el FORMATO, no solo la presencia", () => {
  function mensajeDeValidacionInvalida(entrada: Record<string, string | undefined>): string {
    try {
      validarEntorno(entrada);
    } catch (error) {
      if (error instanceof Error) {
        return error.message;
      }
      throw new Error("La prueba esperaba un Error");
    }
    throw new Error("La prueba esperaba que validarEntorno lanzara");
  }

  function capturarError(entrada: Record<string, string | undefined>): Error {
    try {
      validarEntorno(entrada);
    } catch (error) {
      if (error instanceof Error) {
        return error;
      }
      throw new Error("La prueba esperaba un Error");
    }
    throw new Error("La prueba esperaba que validarEntorno lanzara");
  }

  it("valores basura ('x', 'y@x.com', 'clave') → lanza ErrorDeConfiguracion", () => {
    const error = capturarError({
      FIREBASE_PROJECT_ID: "x",
      FIREBASE_CLIENT_EMAIL: "y@x.com",
      FIREBASE_PRIVATE_KEY: "clave",
      FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
    });
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
  });

  it("el mensaje nombra las variables afectadas sin incluir sus valores", () => {
    const mensaje = mensajeDeValidacionInvalida({
      FIREBASE_PROJECT_ID: "x",
      FIREBASE_CLIENT_EMAIL: "y@x.com",
      FIREBASE_PRIVATE_KEY: "clave",
      FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
    });
    expect(mensaje).toContain("FIREBASE_PROJECT_ID");
    expect(mensaje).toContain("FIREBASE_CLIENT_EMAIL");
    expect(mensaje).toContain("FIREBASE_PRIVATE_KEY");
    // Ningún valor de las variables inválidas debe filtrarse en el mensaje.
    expect(mensaje).not.toContain("y@x.com");
    expect(mensaje).not.toContain('"x"');
    expect(mensaje).not.toContain("clave-web-de-prueba");
  });

  it("evaluarEntorno evalúa PRESENCIA, no validez: dice 'presente' también con valores basura (contrato)", () => {
    const evaluacion = evaluarEntorno({
      FIREBASE_PROJECT_ID: "x",
      FIREBASE_CLIENT_EMAIL: "y@x.com",
      FIREBASE_PRIVATE_KEY: "clave",
      FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
    });
    for (const nombre of OBLIGATORIAS) {
      expect(evaluacion.variables[nombre], nombre).toBe("presente");
    }
    expect(evaluacion.estaCompleto).toBe(true);
  });

  it("un project id con guion bajo o vacío-tras-trim es inválido para validarEntorno", () => {
    const error = capturarError({ ...ENTORNO_COMPLETO, FIREBASE_PROJECT_ID: "mi_proyecto" });
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect(error.message).toContain("FIREBASE_PROJECT_ID");
  });

  it("un correo que no es de cuenta de servicio es inválido", () => {
    const error = capturarError({ ...ENTORNO_COMPLETO, FIREBASE_CLIENT_EMAIL: "ana@ejemplo.com" });
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect(error.message).toContain("FIREBASE_CLIENT_EMAIL");
  });

  it("una clave sin cabecera PEM es inválida", () => {
    const error = capturarError({ ...ENTORNO_COMPLETO, FIREBASE_PRIVATE_KEY: "MIIE..." });
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    expect(error.message).toContain("FIREBASE_PRIVATE_KEY");
  });

  it("una clave PEM con \\n literales es válida (formato acepta el escape y lo normaliza)", () => {
    const entorno = validarEntorno({
      ...ENTORNO_COMPLETO,
      FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----",
    });
    expect(entorno.FIREBASE_PRIVATE_KEY).toContain("-----BEGIN");
    expect(entorno.FIREBASE_PRIVATE_KEY).not.toContain("\\n");
  });
});
