import { describe, expect, it } from "vitest";
import { formatearNota, pistaClavePrivada, validarFormato } from "../scripts/check-env";
import { evaluarEntorno } from "../app/shared/server/env";

/**
 * A0 §4 R8 / criterio 11 · `npm run check:env` (spec §9: probado por función pura).
 * Se importa el script y se prueban sus funciones puras; nunca se ejecuta el CLI.
 *
 * Las notas de `CORS_ORIGINS` se derivan de su estado con una tabla; aquí se
 * comprueba que la nota y el estado no se contradicen en ningún caso.
 */

const ENTORNO_COMPLETO = {
  FIREBASE_PROJECT_ID: "boton-seguridad-test",
  FIREBASE_CLIENT_EMAIL: "servicio@boton-seguridad-test.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----",
  FIREBASE_WEB_API_KEY: "clave-web-de-prueba",
};

function notaDeCors(corsOrigins: string | undefined): string {
  const evaluacion = evaluarEntorno({ ...ENTORNO_COMPLETO, CORS_ORIGINS: corsOrigins });
  return formatearNota(evaluacion);
}

function estadoDeCors(corsOrigins: string | undefined): string {
  return evaluarEntorno({ ...ENTORNO_COMPLETO, CORS_ORIGINS: corsOrigins }).variables.CORS_ORIGINS;
}

describe("check:env · nota de CORS_ORIGINS derivada de su estado", () => {
  it("estado 'presente' (orígenes definidos) → nota dice 'definida (opcional)'", () => {
    expect(estadoDeCors("https://a.com")).toBe("presente");
    expect(notaDeCors("https://a.com")).toContain("CORS_ORIGINS: definida (opcional).");
  });

  it("estado 'vacía' (CORS_ORIGINS=' ') → nota dice 'vacía' y no se contradice (borde)", () => {
    expect(estadoDeCors(" ")).toBe("vacía");
    const nota = notaDeCors(" ");
    expect(nota).toContain("CORS_ORIGINS: vacía (opcional, sin orígenes permitidos).");
    expect(nota).not.toContain("CORS_ORIGINS: definida");
    expect(nota).not.toContain("CORS_ORIGINS: no definida");
  });

  it("estado 'falta' (ausente) → nota dice 'no definida (opcional)'", () => {
    expect(estadoDeCors(undefined)).toBe("falta");
    expect(notaDeCors(undefined)).toContain(
      "CORS_ORIGINS: no definida (opcional, sin orígenes permitidos).",
    );
  });

  it("la nota nunca incluye el valor de CORS_ORIGINS", () => {
    const secreto = "https://secreto-no-debe-salir.example";
    expect(notaDeCors(secreto)).not.toContain(secreto);
  });
});

describe("check:env · nota general según el conjunto de variables", () => {
  it("entorno completo → lo dice y añade la nota de CORS", () => {
    const nota = formatearNota(evaluarEntorno({ ...ENTORNO_COMPLETO }));
    expect(nota).toContain("Entorno completo");
    expect(nota).toContain("CORS_ORIGINS:");
  });

  it("faltan obligatorias → las nombra y no filtra valores", () => {
    const nota = formatearNota(evaluarEntorno({ FIREBASE_PROJECT_ID: "boton-seguridad-test" }));
    expect(nota).toContain("Faltan obligatorias");
    expect(nota).toContain("FIREBASE_WEB_API_KEY");
    expect(nota).not.toContain("boton-seguridad-test");
  });
});

describe("check:env · validación de formato sin exponer valores", () => {
  it("un entorno completo y bien formado es válido y no reporta campos", () => {
    const resultado = validarFormato(ENTORNO_COMPLETO);
    expect(resultado).toEqual({ valido: true, campos: [] });
  });

  it("con obligatorias ausentes no se valida formato ni se inventan campos", () => {
    const resultado = validarFormato({ FIREBASE_PROJECT_ID: "boton-seguridad-test" });
    expect(resultado).toEqual({ valido: false, campos: [] });
  });

  it("un project id con mayúsculas se reporta como FIREBASE_PROJECT_ID", () => {
    const resultado = validarFormato({ ...ENTORNO_COMPLETO, FIREBASE_PROJECT_ID: "Boton-36" });
    expect(resultado.valido).toBe(false);
    expect(resultado.campos).toContain("FIREBASE_PROJECT_ID");
  });

  it("un correo que no es de cuenta de servicio se reporta como FIREBASE_CLIENT_EMAIL", () => {
    const resultado = validarFormato({
      ...ENTORNO_COMPLETO,
      FIREBASE_CLIENT_EMAIL: "persona@ejemplo.com",
    });
    expect(resultado.campos).toContain("FIREBASE_CLIENT_EMAIL");
  });

  it("una clave privada sin cabecera PEM se reporta como FIREBASE_PRIVATE_KEY", () => {
    const resultado = validarFormato({
      ...ENTORNO_COMPLETO,
      FIREBASE_PRIVATE_KEY: "texto-que-no-es-una-clave",
    });
    expect(resultado.campos).toContain("FIREBASE_PRIVATE_KEY");
  });

  it("el resultado solo contiene nombres de variable, nunca sus valores", () => {
    const resultado = validarFormato({
      ...ENTORNO_COMPLETO,
      FIREBASE_PROJECT_ID: "Boton-36",
      FIREBASE_CLIENT_EMAIL: "persona@ejemplo.com",
    });
    const texto = JSON.stringify(resultado);
    expect(texto).not.toContain("boton-seguridad-test");
    expect(texto).not.toContain("persona@ejemplo.com");
    expect(texto).not.toContain("clave-web-de-prueba");
  });
});

describe("check:env · pistas de la clave privada sin revelar su contenido", () => {
  it("una clave sin comillas cortada en el primer espacio sugiere comillas dobles", () => {
    const pistas = pistaClavePrivada("-----BEGIN");
    expect(pistas.join(" ")).toContain("comillas dobles");
    expect(pistas.join(" ")).toContain("primer espacio");
  });

  it("una clave válida no produce pistas", () => {
    const cuerpo = "A".repeat(300);
    const valida = `-----BEGIN PRIVATE KEY-----\\n${cuerpo}\\n-----END PRIVATE KEY-----\\n`;
    expect(pistaClavePrivada(valida)).toEqual([]);
  });

  it("señala el JSON completo y las comillas sobrantes", () => {
    const pistas = pistaClavePrivada('{"private_key": "-----BEGIN PRIVATE KEY-----"}');
    expect(pistas.join(" ")).toContain("JSON");
    const conComillas = `"${"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n"}"`;
    expect(pistaClavePrivada(conComillas).join(" ")).toContain("comillas");
  });

  it("nunca devuelve el valor recibido", () => {
    const secreto = "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7";
    expect(pistaClavePrivada(secreto).join(" ")).not.toContain(secreto);
  });
});
