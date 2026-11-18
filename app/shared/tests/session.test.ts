import { describe, expect, it } from "vitest";
import { ErrorHttpSchema, SesionSchema } from "../schema";
import { NoAutenticado } from "../server/errors";
import { respuestaDeError } from "../server/http";
import { requiereSesion, type VerificadorDeToken } from "../server/session";

const TOKEN_VALIDO = "token-de-prueba";
const MENSAJE_SIN_SESION = "Falta la sesión";
const MENSAJE_INVALIDA = "Sesión inválida o vencida";

type Rol = "admin" | "usuario";

/** Doble del puerto: nunca toca Firebase ni la red. */
function verificadorQueDevuelve(sesion: {
  uid: string;
  email?: string;
  rol: Rol;
}): VerificadorDeToken {
  return {
    async verificar(token: string) {
      expect(token).toBe(TOKEN_VALIDO);
      return SesionSchema.parse(sesion);
    },
  };
}

function verificadorQueFalla(causa: string): VerificadorDeToken {
  return {
    async verificar() {
      // El verificador real loguea la causa; al exterior solo sale el 401 uniforme.
      void causa;
      throw new NoAutenticado(MENSAJE_INVALIDA);
    },
  };
}

function peticionCon(cabeceras: Record<string, string>) {
  return new Request("http://localhost/api/privada", { headers: cabeceras });
}

async function errorDe(promesa: Promise<unknown>): Promise<Error> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error("La prueba esperaba una instancia de Error");
  }
  throw new Error("La prueba esperaba un rechazo y resolvió");
}

async function respuestaDe(promesa: Promise<unknown>) {
  return respuestaDeError((await errorDe(promesa)) as NoAutenticado);
}

async function leerError(respuesta: Response) {
  return ErrorHttpSchema.parse(await respuesta.json());
}

describe("A0 §8.6 · ruta privada sin Authorization → 401 'Falta la sesión'", () => {
  it("sin cabecera lanza NoAutenticado con ese mensaje", async () => {
    const error = await errorDe(
      requiereSesion(peticionCon({}), verificadorQueDevuelve({ uid: "u1", rol: "usuario" })),
    );
    expect(error).toBeInstanceOf(NoAutenticado);
    const respuesta = respuestaDeError(error as NoAutenticado);
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe(MENSAJE_SIN_SESION);
  });
});

describe("A0 §8.7 · formas de cabecera inválidas → 401", () => {
  const cabecerasInvalidas: Array<{ caso: string; cabeceras: Record<string, string> }> = [
    { caso: "Authorization: Basic x", cabeceras: { authorization: "Basic x" } },
    { caso: "authorization: bearer x (minúsculas)", cabeceras: { authorization: "bearer x" } },
    { caso: "Bearer sin token", cabeceras: { authorization: "Bearer " } },
    { caso: "Bearer con doble espacio", cabeceras: { authorization: "Bearer  x" } },
    { caso: "token sin prefijo", cabeceras: { authorization: "x" } },
    { caso: "Bearer entrecomillado", cabeceras: { authorization: 'Bearer "x"' } },
  ];

  for (const { caso, cabeceras } of cabecerasInvalidas) {
    it(`${caso} → 401`, async () => {
      const respuesta = await respuestaDe(
        requiereSesion(
          peticionCon(cabeceras),
          verificadorQueDevuelve({ uid: "u1", rol: "usuario" }),
        ),
      );
      expect(respuesta.status).toBe(401);
    });
  }

  it("un token de 4097 caracteres se rechaza antes de verificar", async () => {
    let verificado = false;
    const verificador: VerificadorDeToken = {
      async verificar() {
        verificado = true;
        return SesionSchema.parse({ uid: "u1", rol: "usuario" });
      },
    };
    const peticion = peticionCon({ authorization: `Bearer ${"a".repeat(4097)}` });
    const respuesta = await respuestaDe(requiereSesion(peticion, verificador));
    expect(respuesta.status).toBe(401);
    expect(verificado).toBe(false);
  });

  it("un token de 4096 caracteres sí llega al verificador", async () => {
    let recibido = "";
    const verificador: VerificadorDeToken = {
      async verificar(token: string) {
        recibido = token;
        return SesionSchema.parse({ uid: "u1", rol: "usuario" });
      },
    };
    const token = "a".repeat(4096);
    const peticion = peticionCon({ authorization: `Bearer ${token}` });
    const sesion = await requiereSesion(peticion, verificador);
    expect(recibido).toBe(token);
    expect(SesionSchema.parse(sesion).uid).toBe("u1");
  });
});

describe("A0 §8.8 · token vencido o inválido → 401 'Sesión inválida o vencida'", () => {
  const fallos = [
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/invalid-signature",
    "auth/wrong-audience",
    "auth/project-not-found",
  ];

  for (const fallo of fallos) {
    it(`verificador lanza ${fallo} → mismo mensaje 401`, async () => {
      const peticion = peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` });
      const respuesta = await respuestaDe(requiereSesion(peticion, verificadorQueFalla(fallo)));
      expect(respuesta.status).toBe(401);
      expect((await leerError(respuesta)).error).toBe(MENSAJE_INVALIDA);
    });
  }

  it("no se distingue la causa: todas las fallas dan el mismo cuerpo", async () => {
    const textos = new Set<string>();
    for (const fallo of fallos) {
      const peticion = peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` });
      const respuesta = await respuestaDe(requiereSesion(peticion, verificadorQueFalla(fallo)));
      textos.add(JSON.stringify(await leerError(respuesta)));
    }
    expect(textos.size).toBe(1);
  });

  it("la causa original no se filtra en la respuesta", async () => {
    const peticion = peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` });
    const respuesta = await respuestaDe(
      requiereSesion(peticion, verificadorQueFalla("firma rota del proyecto otro")),
    );
    const texto = await respuesta.clone().text();
    expect(texto).not.toContain("firma rota");
    expect(texto).not.toContain("otro");
  });
});

describe("A0 §8.9 · sesión derivada del token", () => {
  it("uid=u1 con claim rol=admin → { uid: 'u1', rol: 'admin' }", async () => {
    const sesion = await requiereSesion(
      peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }),
      verificadorQueDevuelve({ uid: "u1", email: "ana@ejemplo.com", rol: "admin" }),
    );
    const validada = SesionSchema.parse(sesion);
    expect(validada.uid).toBe("u1");
    expect(validada.rol).toBe("admin");
  });

  it("sin claim de rol la sesión es 'usuario'", async () => {
    const sesion = await requiereSesion(
      peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }),
      verificadorQueDevuelve({ uid: "u1", rol: "usuario" }),
    );
    const validada = SesionSchema.parse(sesion);
    expect(validada.rol).toBe("usuario");
    expect(validada.uid).toBe("u1");
  });

  it("la sesión cumple SesionSchema", async () => {
    const sesion = await requiereSesion(
      peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }),
      verificadorQueDevuelve({ uid: "u1", rol: "usuario" }),
    );
    expect(() => SesionSchema.parse(sesion)).not.toThrow();
  });
});

describe("A0 §5 · autorización: identidad solo desde el token", () => {
  it("token cuyo payload no trae uid → 401", async () => {
    const verificador: VerificadorDeToken = {
      async verificar() {
        const resultado = SesionSchema.safeParse({ rol: "usuario" });
        if (!resultado.success) {
          throw new NoAutenticado(MENSAJE_INVALIDA);
        }
        return resultado.data;
      },
    };
    const respuesta = await respuestaDe(
      requiereSesion(peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }), verificador),
    );
    expect(respuesta.status).toBe(401);
  });

  it("token de otro proyecto → 401 'Sesión inválida o vencida'", async () => {
    const respuesta = await respuestaDe(
      requiereSesion(
        peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }),
        verificadorQueFalla("auth/wrong-audience otro-proyecto"),
      ),
    );
    expect(respuesta.status).toBe(401);
    expect((await leerError(respuesta)).error).toBe(MENSAJE_INVALIDA);
  });

  it("el verificador recibe exactamente el token de la cabecera, no uid del cuerpo ni de la URL", async () => {
    let recibido = "";
    const verificador: VerificadorDeToken = {
      async verificar(token: string) {
        recibido = token;
        return SesionSchema.parse({ uid: "u1", rol: "usuario" });
      },
    };
    const peticion = new Request("http://localhost/api/privada?uid=u2", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN_VALIDO}`, "content-type": "application/json" },
      body: JSON.stringify({ uid: "u2" }),
    });
    const sesion = await requiereSesion(peticion, verificador);
    expect(recibido).toBe(TOKEN_VALIDO);
    expect(SesionSchema.parse(sesion).uid).toBe("u1");
    expect(SesionSchema.parse(sesion).uid).not.toBe("u2");
  });
});

describe("A0 §6 · el puerto VerificadorDeToken se sustituye sin red ni Firebase", () => {
  it("un doble resuelve la sesión sin tocar el SDK real", async () => {
    const verificador = verificadorQueDevuelve({ uid: "u1", rol: "usuario" });
    expect(typeof verificador.verificar).toBe("function");
    const sesion = await requiereSesion(
      peticionCon({ authorization: `Bearer ${TOKEN_VALIDO}` }),
      verificador,
    );
    expect(sesion.uid).toBe("u1");
  });
});
