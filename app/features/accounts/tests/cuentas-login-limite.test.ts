import { describe, expect, it } from "vitest";
import { LoginSchema, SesionSchema, type Login } from "@/shared/schema";
import { DemasiadosIntentos, ErrorDeDominio, ErrorInterno } from "@/shared/server/errors";
import type { VerificadorDeToken } from "@/shared/server/session";
import type { Reloj } from "@/shared/server/time";
import {
  ErrorDeCuenta,
  type AuthRespuesta,
  type ClienteAuth,
  type CodigoFirebase,
  type Credenciales,
} from "@/shared/server/auth-client";
import { crearServicioCuentas } from "../server/cuentas-service";
import { MENSAJE_LIMITE, UMBRAL_IP, UMBRAL_PAR } from "../server/intentos";
import { crearServicioIntentos } from "../server/intentos-service";
import type { RepositorioIntentos } from "../server/intentos-repository";
import { crearRepositorioIntentosEnMemoria } from "../server/intentos-repository.memory";
import { crearRepositorioPerfilEnMemoria } from "../server/repository.memory";

/**
 * Spec A6 · el límite de intentos dentro del login real (A1 + A6).
 *
 * Se usa el servicio de cuentas de producción con el servicio de intentos
 * real, almacén en memoria y reloj movible: cero red, cero Firebase, cero
 * `setTimeout`. Aquí se comprueba lo que solo se ve al integrar ambas capas:
 * cuántos fallos cuentan, cuándo llega el 429 sin tocar Auth, que un éxito
 * reinicia y que un almacén caído no abre la puerta (fail-closed).
 */

const AHORA = new Date("2026-11-14T08:00:00.000Z");
const CORREO = "ana@x.com";
const CONTRASENA = "contrasena-larga-123";
const UID = "uid-ana";
const IP = "203.0.113.9";
const OTRA_IP = "198.51.100.7";
const QUINCE_MINUTOS = 15 * 60 * 1000;

const LOGIN: Login = LoginSchema.parse({ email: CORREO, password: CONTRASENA });

type RelojDePrueba = {
  reloj: Reloj;
  avanzar(ms: number): void;
};

function relojDesde(inicio: Date): RelojDePrueba {
  let instante = new Date(inicio.getTime());
  return {
    reloj: {
      ahora() {
        return new Date(instante.getTime());
      },
    },
    avanzar(ms: number): void {
      instante = new Date(instante.getTime() + ms);
    },
  };
}

/** Verificador que siempre devuelve la sesión de la cuenta de prueba. */
const VERIFICADOR: VerificadorDeToken = {
  async verificar(token: string) {
    expect(token.length).toBeGreaterThan(0);
    return SesionSchema.parse({ uid: UID, email: CORREO, rol: "usuario" });
  },
};

function authRespuesta(): AuthRespuesta {
  return {
    uid: UID,
    email: CORREO,
    idToken: "id-token-emitido",
    refreshToken: "refresh-emitido",
    expiraEnSeg: 3600,
  };
}

/** Resultado programado de un intento de login. */
type Resultado = "ok" | CodigoFirebase;

const FALLO: Resultado = "INVALID_PASSWORD";

/** Lista de `veces` fallos de credenciales y, detrás, los resultados indicados. */
function fallos(veces: number, ...resto: Resultado[]): Resultado[] {
  const lista: Resultado[] = [];
  for (let indice = 0; indice < veces; indice += 1) {
    lista.push(FALLO);
  }
  return [...lista, ...resto];
}

/**
 * `ClienteAuth` que responde en orden a cada `iniciarSesion`; agotada la lista
 * repite el último resultado. Registra las credenciales que recibió. Los demás
 * métodos no se usan en login y fallan si alguien los toca.
 */
function clienteProgramado(resultados: Resultado[]) {
  const llamadas: Credenciales[] = [];
  const noUsado = (): Promise<never> => Promise.reject(new Error("no usado en A6"));
  const clienteAuth: ClienteAuth = {
    registrar: noUsado,
    async iniciarSesion(datos: Credenciales): Promise<AuthRespuesta> {
      llamadas.push(datos);
      const indice = Math.min(llamadas.length - 1, resultados.length - 1);
      const resultado = resultados[indice] ?? "ok";
      if (resultado === "ok") {
        return authRespuesta();
      }
      throw new ErrorDeCuenta(resultado);
    },
    renovar: noUsado,
    asignarRol: noUsado,
    eliminarCuenta: noUsado,
  };
  return { clienteAuth, llamadas };
}

/** Servicio completo con intentos reales sobre el almacén indicado. */
function servicioCon(
  clienteAuth: ClienteAuth,
  reloj: Reloj,
  repositorioIntentos: RepositorioIntentos,
) {
  return crearServicioCuentas({
    clienteAuth,
    repositorio: crearRepositorioPerfilEnMemoria(),
    verificador: VERIFICADOR,
    reloj,
    intentos: crearServicioIntentos({ repositorio: repositorioIntentos, reloj }),
  });
}

/** Almacén en memoria recién creado. */
function almacen(): RepositorioIntentos {
  return crearRepositorioIntentosEnMemoria();
}

/** Ejecuta y devuelve el error de dominio; falla si resuelve. */
async function capturar(promesa: Promise<object>): Promise<ErrorDeDominio> {
  try {
    await promesa;
  } catch (capturado) {
    if (capturado instanceof ErrorDeDominio) {
      return capturado;
    }
    throw capturado;
  }
  throw new Error("La prueba esperaba un rechazo y resolvió");
}

/** Ejecuta `veces` logins que deben fallar con el código dado. */
async function fallar(veces: number, ejecutar: () => Promise<object>): Promise<void> {
  for (let intento = 0; intento < veces; intento += 1) {
    const error = await capturar(ejecutar());
    expect(error.codigo).toBe(401);
  }
}

/** Repositorio que falla siempre, en lectura y en escritura. */
function almacenCaido(): RepositorioIntentos {
  return {
    async leer(): Promise<never> {
      throw new Error("Firestore caído");
    },
    async ejecutar(): Promise<never> {
      throw new Error("Firestore caído");
    },
  };
}

// ---------------------------------------------------------------------------
// R2, R3: cinco fallos bloquean y el sexto no llega a Auth
// ---------------------------------------------------------------------------

describe("A6 §8.1 · cinco fallos del par → 401; el sexto → 429 sin tocar Auth", () => {
  it("los cinco primeros responden 401 y el sexto 429 con el mensaje literal", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(["INVALID_PASSWORD"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(UMBRAL_PAR, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    const bloqueado = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));

    expect(bloqueado).toBeInstanceOf(DemasiadosIntentos);
    expect(bloqueado.codigo).toBe(429);
    expect(bloqueado.message).toBe(MENSAJE_LIMITE);
    expect(llamadas).toHaveLength(UMBRAL_PAR);
  });

  it("el bloqueo no depende del correo con otra IP (el par cambia)", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(fallos(UMBRAL_PAR, "ok"));
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(UMBRAL_PAR, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    const cuenta = await servicio.iniciarSesion(LOGIN, { ip: OTRA_IP });

    expect(cuenta.usuario.id).toBe(UID);
    expect(llamadas).toHaveLength(UMBRAL_PAR + 1);
  });
});

// ---------------------------------------------------------------------------
// R2, R5: la ventana y el bloqueo caducan
// ---------------------------------------------------------------------------

describe("A6 §8.2 · pasados 15 minutos el login vuelve a intentarse", () => {
  it("tras el bloqueo, un intento 15 min después llega a Auth y entra", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(fallos(UMBRAL_PAR, "ok"));
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(UMBRAL_PAR, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    expect((await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }))).codigo).toBe(429);

    reloj.avanzar(QUINCE_MINUTOS + 1);
    const cuenta = await servicio.iniciarSesion(LOGIN, { ip: IP });

    expect(cuenta.usuario.email).toBe(CORREO);
    expect(llamadas).toHaveLength(UMBRAL_PAR + 1);
  });

  it("un fallo viejo ya fuera de la ventana arranca el contador de cero", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(fallos(9));
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(UMBRAL_PAR - 1, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    reloj.avanzar(QUINCE_MINUTOS + 1);
    await fallar(UMBRAL_PAR - 1, () => servicio.iniciarSesion(LOGIN, { ip: IP }));

    const ultimo = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
    expect(ultimo.codigo).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// R3, R11: el éxito reinicia
// ---------------------------------------------------------------------------

describe("A6 §8.3 · un login correcto borra los contadores", () => {
  it("tras un éxito, cuatro fallos nuevos no bloquean el quinto… aún", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado([...fallos(4), "ok", ...fallos(5)]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(4, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    await servicio.iniciarSesion(LOGIN, { ip: IP });
    await fallar(4, () => servicio.iniciarSesion(LOGIN, { ip: IP }));

    const quinto = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
    expect(quinto.codigo).toBe(401);
  });

  it("el éxito también limpia el contador de la IP sola", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado([...fallos(4), "ok", ...fallos(5)]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    await fallar(UMBRAL_PAR - 1, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    await servicio.iniciarSesion(LOGIN, { ip: IP });

    await fallar(UMBRAL_PAR - 1, () => servicio.iniciarSesion(LOGIN, { ip: IP }));
    const ultimo = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
    expect(ultimo.codigo).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// R4: solo cuentan los fallos de credenciales
// ---------------------------------------------------------------------------

describe("A6 §8.4 · los fallos que no son de credenciales no suman", () => {
  it("cinco cuentas deshabilitadas (403) no bloquean el login", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["USER_DISABLED"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let intento = 0; intento < UMBRAL_PAR + 1; intento += 1) {
      const error = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
      expect(error.codigo).toBe(403);
    }
  });

  it("cinco fallos de red (500) no bloquean el login", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["RED"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let intento = 0; intento < UMBRAL_PAR + 1; intento += 1) {
      const error = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
      expect(error.codigo).toBe(500);
    }
  });

  it("tras cuatro 403, el quinto fallo de credenciales sigue siendo 401", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado([
      "USER_DISABLED",
      "USER_DISABLED",
      "USER_DISABLED",
      "USER_DISABLED",
      "INVALID_PASSWORD",
    ]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let intento = 0; intento < 4; intento += 1) {
      expect((await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }))).codigo).toBe(403);
    }
    expect((await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }))).codigo).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// R2, R7: IP sola y modo degradado sin IP
// ---------------------------------------------------------------------------

describe("A6 §8.5 · el contador de la IP sola corta el rociado de correos", () => {
  it("20 fallos de 20 correos distintos desde la misma IP bloquean el 21", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(["INVALID_PASSWORD"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let indice = 0; indice < UMBRAL_IP; indice += 1) {
      const datos = LoginSchema.parse({
        email: `persona${indice}@x.com`,
        password: CONTRASENA,
      });
      await fallar(1, () => servicio.iniciarSesion(datos, { ip: IP }));
    }

    const otro = LoginSchema.parse({ email: "otra@x.com", password: CONTRASENA });
    const bloqueado = await capturar(servicio.iniciarSesion(otro, { ip: IP }));

    expect(bloqueado.codigo).toBe(429);
    expect(llamadas).toHaveLength(UMBRAL_IP);
  });

  it("sin IP se usa el correo solo: cinco fallos bloquean el sexto", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(["INVALID_PASSWORD"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await capturar(servicio.iniciarSesion(LOGIN));
    }
    const bloqueado = await capturar(servicio.iniciarSesion(LOGIN));

    expect(bloqueado.codigo).toBe(429);
    expect(llamadas).toHaveLength(UMBRAL_PAR);
  });

  it("sin IP el límite es por correo, no global", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["INVALID_PASSWORD"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await capturar(servicio.iniciarSesion(LOGIN));
    }
    const otra = LoginSchema.parse({ email: "beto@x.com", password: CONTRASENA });
    const error = await capturar(servicio.iniciarSesion(otra));

    expect(error.codigo).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// R6: el almacén no guarda correo, IP ni contraseña en claro
// ---------------------------------------------------------------------------

describe("A6 §8.6 · las claves guardadas son hashes opacos", () => {
  it("ni el correo, ni la IP, ni la contraseña aparecen en las claves", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["INVALID_PASSWORD"]);
    const guardadas: string[] = [];
    const real = almacen();
    const espia: RepositorioIntentos = {
      async leer(clave: string) {
        guardadas.push(clave);
        return real.leer(clave);
      },
      async ejecutar(clave, operacion) {
        guardadas.push(clave);
        return real.ejecutar(clave, operacion);
      },
    };
    const servicio = servicioCon(clienteAuth, reloj.reloj, espia);

    await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));

    expect(guardadas.length).toBeGreaterThan(0);
    for (const clave of guardadas) {
      expect(clave).not.toContain(CORREO);
      expect(clave).not.toContain(IP);
      expect(clave).not.toContain(CONTRASENA);
      expect(clave).toMatch(/^(par|ip|correo)_[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// R10: fail-closed
// ---------------------------------------------------------------------------

describe("A6 §8.7 · si el almacén falla, el login no se salta el límite", () => {
  it("un fallo al leer el contador responde 500 y no llama a Auth", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(["ok"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacenCaido());

    const error = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));

    expect(error).toBeInstanceOf(ErrorInterno);
    expect(error.codigo).toBe(500);
    expect(llamadas).toHaveLength(0);
  });

  it("un fallo al registrar el fallo responde 500 en vez de 401", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["INVALID_PASSWORD"]);
    const real = almacen();
    const roto: RepositorioIntentos = {
      leer(clave) {
        return real.leer(clave);
      },
      async ejecutar(): Promise<never> {
        throw new Error("Firestore caído");
      },
    };
    const servicio = servicioCon(clienteAuth, reloj.reloj, roto);

    const error = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));

    expect(error.codigo).toBe(500);
  });

  it("un fallo al reiniciar tras un éxito no tumba el login", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth } = clienteProgramado(["ok"]);
    const real = almacen();
    const roto: RepositorioIntentos = {
      async leer(clave: string) {
        return real.leer(clave);
      },
      async ejecutar(): Promise<never> {
        throw new Error("Firestore caído");
      },
    };
    const servicio = servicioCon(clienteAuth, reloj.reloj, roto);

    const cuenta = await servicio.iniciarSesion(LOGIN, { ip: IP });

    expect(cuenta.token).toBe("id-token-emitido");
    expect(cuenta.usuario.id).toBe(UID);
  });
});

// ---------------------------------------------------------------------------
// Residual documentado (ADR-0012): la verificación no reserva el intento
// ---------------------------------------------------------------------------

describe("A6 §8.11 · una ráfaga simultánea pasa la verificación previa", () => {
  it("8 intentos en paralelo llegan a Auth; el contador queda alto y el 9.º bloquea", async () => {
    const reloj = relojDesde(AHORA);
    const { clienteAuth, llamadas } = clienteProgramado(["INVALID_PASSWORD"]);
    const servicio = servicioCon(clienteAuth, reloj.reloj, almacen());

    const rafaga: Array<Promise<ErrorDeDominio>> = [];
    for (let intento = 0; intento < 8; intento += 1) {
      rafaga.push(capturar(servicio.iniciarSesion(LOGIN, { ip: IP })));
    }
    const errores = await Promise.all(rafaga);

    expect(errores.every((error) => error.codigo === 401)).toBe(true);
    expect(llamadas).toHaveLength(8);

    const siguiente = await capturar(servicio.iniciarSesion(LOGIN, { ip: IP }));
    expect(siguiente.codigo).toBe(429);
    expect(llamadas).toHaveLength(8);
  });
});
