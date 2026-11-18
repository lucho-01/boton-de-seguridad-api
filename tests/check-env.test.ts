import { describe, expect, it } from "vitest";
import { formatearNota } from "../scripts/check-env";
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
