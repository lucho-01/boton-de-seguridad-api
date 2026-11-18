import { describe, expect, it } from "vitest";
import { LoginSchema, type Login } from "@/shared/schema";
import { DemasiadosIntentos, ErrorInterno } from "@/shared/server/errors";
import type { Reloj } from "@/shared/server/time";
import {
  BLOQUEO_MS,
  type EstadoIntentos,
  UMBRAL_IP,
  UMBRAL_PAR,
  VENTANA_MS,
  estadoTrasFallo,
  estaBloqueado,
} from "../server/intentos";
import type { RepositorioIntentos } from "../server/intentos-repository";
import { crearRepositorioIntentosEnMemoria } from "../server/intentos-repository.memory";
import {
  claveDeIp,
  claveDePar,
  crearServicioIntentos,
  hashSha256,
} from "../server/intentos-service";

/**
 * Spec A6 · contadores del límite de login (R1–R11, §8 criterios 1–12).
 *
 * Se prueba la decisión pura (`estadoTrasFallo`, `estaBloqueado`), el servicio
 * con repositorio en memoria y reloj inyectado, y el repositorio en memoria
 * (persistencia, borrado y copias defensivas). Cero red, cero Firebase y cero
 * `setTimeout`: el tiempo solo avanza con el reloj de prueba.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const AHORA = new Date("2026-11-16T10:00:00.000Z");
const CORREO = "ana@x.com";
const CONTRASENA = "contrasena-larga-123";
const IP = "203.0.113.9";
const MENSAJE_LIMITE = "Demasiados intentos; espera unos minutos";

const LOGIN: Login = LoginSchema.parse({ email: CORREO, password: CONTRASENA });

// ---------------------------------------------------------------------------
// Utilidades: reloj movible, estados de partida y repositorios que fallan.
// ---------------------------------------------------------------------------

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

function sumar(fecha: Date, ms: number): Date {
  return new Date(fecha.getTime() + ms);
}

/** Estado con TTL de 24 h desde `inicio`, listo para alimentar el contador. */
function estadoDe(fallos: number, inicio: Date, bloqueado: Date | null): EstadoIntentos {
  let bloqueadoIso: string | null = null;
  if (bloqueado !== null) {
    bloqueadoIso = bloqueado.toISOString();
  }
  return {
    fallos,
    ventana_inicio: inicio.toISOString(),
    bloqueado_hasta: bloqueadoIso,
    expira_en: sumar(inicio, TTL_MS).toISOString(),
  };
}

/** Repositorio caído: falla en lectura y escritura. */
function repositorioQueFalla(): RepositorioIntentos {
  return {
    async leer(): Promise<EstadoIntentos | null> {
      throw new Error("Firestore caído");
    },
    async ejecutar(): Promise<EstadoIntentos | null> {
      throw new Error("Firestore caído");
    },
  };
}

/** Repositorio que lee bien pero falla al escribir (transacción caída). */
function repositorioQueFallaAlEscribir(): RepositorioIntentos {
  return {
    async leer(): Promise<EstadoIntentos | null> {
      return null;
    },
    async ejecutar(): Promise<EstadoIntentos | null> {
      throw new Error("Firestore caído");
    },
  };
}

function servicioCon(reloj: Reloj, repositorio?: RepositorioIntentos) {
  let elegido: RepositorioIntentos = crearRepositorioIntentosEnMemoria();
  if (repositorio !== undefined) {
    elegido = repositorio;
  }
  return { servicio: crearServicioIntentos({ repositorio: elegido, reloj }), repositorio: elegido };
}

function loginDe(correo: string): Login {
  return LoginSchema.parse({ email: correo, password: CONTRASENA });
}

// ---------------------------------------------------------------------------
// Función pura: estadoTrasFallo (R1, R2, R9)
// ---------------------------------------------------------------------------

describe("A6 §8.1 · el primer fallo abre la ventana en 1", () => {
  it("fallos 1, ventana_inicio = ahora, sin bloqueo y TTL de 24 h", () => {
    const estado = estadoTrasFallo(null, AHORA, UMBRAL_PAR);
    expect(estado.fallos).toBe(1);
    expect(estado.ventana_inicio).toBe(AHORA.toISOString());
    expect(estado.bloqueado_hasta).toBeNull();
    expect(estado.expira_en).toBe(sumar(AHORA, TTL_MS).toISOString());
  });

  it("no muta el estado anterior (función pura)", () => {
    const previo: EstadoIntentos = Object.freeze(estadoDe(2, AHORA, null)) as EstadoIntentos;
    const estado = estadoTrasFallo(previo, sumar(AHORA, 60_000), UMBRAL_PAR);
    expect(estado.fallos).toBe(3);
    expect(previo.fallos).toBe(2);
    expect(previo.bloqueado_hasta).toBeNull();
  });
});

describe("A6 §8.2 · dentro de la ventana los fallos se suman", () => {
  it("dos fallos a 1 y 5 minutos conservan ventana_inicio y no bloquean", () => {
    const primero = estadoTrasFallo(null, AHORA, UMBRAL_PAR);
    const segundo = estadoTrasFallo(primero, sumar(AHORA, 60_000), UMBRAL_PAR);
    const tercero = estadoTrasFallo(segundo, sumar(AHORA, 5 * 60_000), UMBRAL_PAR);
    expect(tercero.fallos).toBe(3);
    expect(tercero.ventana_inicio).toBe(AHORA.toISOString());
    expect(tercero.bloqueado_hasta).toBeNull();
  });

  it("el cuarto fallo todavía no bloquea con umbral 5", () => {
    const cuarto = estadoTrasFallo(estadoDe(3, AHORA, null), sumar(AHORA, 60_000), UMBRAL_PAR);
    expect(cuarto.fallos).toBe(4);
    expect(cuarto.bloqueado_hasta).toBeNull();
  });
});

describe("A6 §8.3 · pasada la ventana el contador se reinicia", () => {
  it("tras más de 15 minutos vuelve a 1 con la nueva ventana", () => {
    const despues = sumar(AHORA, VENTANA_MS + 1);
    const estado = estadoTrasFallo(estadoDe(4, AHORA, null), despues, UMBRAL_PAR);
    expect(estado.fallos).toBe(1);
    expect(estado.ventana_inicio).toBe(despues.toISOString());
    expect(estado.bloqueado_hasta).toBeNull();
  });

  it("un estado bloqueado caducado también se reinicia (TTL no obligatorio)", () => {
    const bloqueado = estadoDe(5, AHORA, sumar(AHORA, BLOQUEO_MS));
    const despues = sumar(AHORA, VENTANA_MS + 1);
    const estado = estadoTrasFallo(bloqueado, despues, UMBRAL_PAR);
    expect(estado.fallos).toBe(1);
    expect(estado.bloqueado_hasta).toBeNull();
  });
});

describe("A6 §8 · al llegar al umbral el contador se bloquea 15 minutos", () => {
  it("el fallo número 5 (umbral del par) bloquea desde ese instante", () => {
    const ultimo = sumar(AHORA, 2 * 60_000);
    const estado = estadoTrasFallo(estadoDe(4, AHORA, null), ultimo, UMBRAL_PAR);
    expect(estado.fallos).toBe(UMBRAL_PAR);
    expect(estado.bloqueado_hasta).toBe(sumar(ultimo, BLOQUEO_MS).toISOString());
  });

  it("umbral 1 bloquea ya en el primer fallo (borde inferior)", () => {
    const estado = estadoTrasFallo(null, AHORA, 1);
    expect(estado.fallos).toBe(1);
    expect(estado.bloqueado_hasta).toBe(sumar(AHORA, BLOQUEO_MS).toISOString());
  });

  it("umbral 2 no bloquea en el primer fallo y sí en el segundo", () => {
    const primero = estadoTrasFallo(null, AHORA, 2);
    expect(primero.bloqueado_hasta).toBeNull();
    const segundo = estadoTrasFallo(primero, sumar(AHORA, 1000), 2);
    expect(segundo.bloqueado_hasta).toBe(sumar(AHORA, 1000 + BLOQUEO_MS).toISOString());
  });

  it("expira_en queda después del fin del bloqueo (R9)", () => {
    const estado = estadoTrasFallo(estadoDe(4, AHORA, null), AHORA, UMBRAL_PAR);
    expect(estado.bloqueado_hasta).not.toBeNull();
    const expira = Date.parse(estado.expira_en);
    const bloqueo = Date.parse(estado.bloqueado_hasta ?? "");
    expect(expira).toBeGreaterThan(bloqueo);
  });
});

// ---------------------------------------------------------------------------
// Función pura: estaBloqueado (R2, R3)
// ---------------------------------------------------------------------------

describe("A6 §8 · estaBloqueado distingue antes y después del bloqueo", () => {
  it("sin estado previo no está bloqueado", () => {
    expect(estaBloqueado(null, AHORA)).toBe(false);
  });

  it("fallos por debajo del umbral y sin bloqueado_hasta no están bloqueados", () => {
    expect(estaBloqueado(estadoDe(4, AHORA, null), AHORA)).toBe(false);
  });

  it("un bloqueado_hasta futuro está bloqueado", () => {
    expect(estaBloqueado(estadoDe(5, AHORA, sumar(AHORA, BLOQUEO_MS)), AHORA)).toBe(true);
  });

  it("pasado el bloqueado_hasta ya no está bloqueado", () => {
    const bloqueado = estadoDe(5, AHORA, sumar(AHORA, BLOQUEO_MS));
    expect(estaBloqueado(bloqueado, sumar(AHORA, BLOQUEO_MS + 1))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Servicio (R1–R6, R11)
// ---------------------------------------------------------------------------

describe("A6 §8.1 y §8.2 · 5 fallos del par → el sexto intento es 429", () => {
  it("verificar rechaza con DemasiadosIntentos y el mensaje literal", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await servicio.registrarFallo(LOGIN, IP);
    }
    const error = await servicio.verificar(LOGIN, IP).then(
      () => null,
      (capturado: Error) => capturado,
    );
    expect(error).toBeInstanceOf(DemasiadosIntentos);
    if (error !== null) {
      expect(error.message).toBe(MENSAJE_LIMITE);
    }
  });

  it("el quinto fallo todavía permite intentar (401 real) y el sexto ya no", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.registrarFallo(LOGIN, IP);
    await expect(servicio.verificar(LOGIN, IP)).resolves.toBeUndefined();
    await servicio.registrarFallo(LOGIN, IP);
    await expect(servicio.verificar(LOGIN, IP)).rejects.toBeInstanceOf(DemasiadosIntentos);
  });
});

describe("A6 §8.5 · cinco fallos del mismo correo desde IPs distintas no bloquean", () => {
  it("el par de cada IP queda en 1 y cualquier cliente sigue pasando", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio, repositorio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await servicio.registrarFallo(LOGIN, `10.0.0.${intento + 1}`);
    }
    await expect(servicio.verificar(LOGIN, "10.0.0.99")).resolves.toBeUndefined();
    await expect(servicio.verificar(LOGIN, "10.0.0.1")).resolves.toBeUndefined();
    const par = await repositorio.leer(claveDePar(CORREO, "10.0.0.1"));
    expect(par?.fallos).toBe(1);
  });
});

describe("A6 §8.6 · veinte fallos desde una misma IP bloquean esa IP", () => {
  it("con correos variados la IP llega a su umbral y frena a un correo nuevo", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_IP; intento += 1) {
      await servicio.registrarFallo(loginDe(`persona-${intento}@x.com`), IP);
    }
    await expect(servicio.verificar(loginDe("otra@x.com"), IP)).rejects.toBeInstanceOf(
      DemasiadosIntentos,
    );
    await expect(
      servicio.verificar(loginDe("otra@x.com"), "198.51.100.7"),
    ).resolves.toBeUndefined();
  });

  it("una IP con 19 fallos todavía no bloquea (límite - 1)", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_IP - 1; intento += 1) {
      await servicio.registrarFallo(loginDe(`persona-${intento}@x.com`), IP);
    }
    await expect(servicio.verificar(loginDe("otra@x.com"), IP)).resolves.toBeUndefined();
  });
});

describe("A6 §8.8 · sin IP solo se aplica el contador del correo", () => {
  it("cinco fallos con ip null bloquean el correo en modo degradado", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio, repositorio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await servicio.registrarFallo(LOGIN, null);
    }
    await expect(servicio.verificar(LOGIN, null)).rejects.toBeInstanceOf(DemasiadosIntentos);
    const clave = claveDePar(CORREO, null);
    expect(clave.startsWith("correo_")).toBe(true);
    expect(await repositorio.leer(clave)).not.toBeNull();
  });

  it("un correo bloqueado sin IP no bloquea a otro correo", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj);
    for (let intento = 0; intento < UMBRAL_PAR; intento += 1) {
      await servicio.registrarFallo(LOGIN, null);
    }
    await expect(servicio.verificar(loginDe("beto@x.com"), null)).resolves.toBeUndefined();
  });
});

describe("A6 §8.3 · verificar nunca suma ni reinicia", () => {
  it("tres verificaciones seguidas dejan el almacén vacío", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio, repositorio } = servicioCon(reloj);
    await servicio.verificar(LOGIN, IP);
    await servicio.verificar(LOGIN, IP);
    await servicio.verificar(LOGIN, IP);
    expect(await repositorio.leer(claveDePar(CORREO, IP))).toBeNull();
    expect(await repositorio.leer(claveDeIp(IP))).toBeNull();
  });
});

describe("A6 §8.4 · reiniciar borra ambos contadores", () => {
  it("tras un éxito el par y la IP quedan a cero y el siguiente fallo vuelve a 1", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio, repositorio } = servicioCon(reloj);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.registrarFallo(LOGIN, IP);
    await servicio.reiniciar(LOGIN, IP);
    expect(await repositorio.leer(claveDePar(CORREO, IP))).toBeNull();
    expect(await repositorio.leer(claveDeIp(IP))).toBeNull();
    await expect(servicio.verificar(LOGIN, IP)).resolves.toBeUndefined();
    await servicio.registrarFallo(LOGIN, IP);
    expect((await repositorio.leer(claveDePar(CORREO, IP)))?.fallos).toBe(1);
  });
});

describe("A6 §8.12 · si el almacén falla, no se salta el límite", () => {
  it("fallo al verificar → ErrorInterno", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj, repositorioQueFalla());
    await expect(servicio.verificar(LOGIN, IP)).rejects.toBeInstanceOf(ErrorInterno);
  });

  it("fallo al registrar un fallo → ErrorInterno", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj, repositorioQueFallaAlEscribir());
    await expect(servicio.registrarFallo(LOGIN, IP)).rejects.toBeInstanceOf(ErrorInterno);
  });

  it("fallo al reiniciar tras un éxito → no lanza (no se castiga a quien acertó)", async () => {
    const { reloj } = relojDesde(AHORA);
    const { servicio } = servicioCon(reloj, repositorioQueFallaAlEscribir());
    await expect(servicio.reiniciar(LOGIN, IP)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Identificadores: hash y prefijo, nunca el dato en claro (R6)
// ---------------------------------------------------------------------------

describe("A6 §8.11 · las claves llevan prefijo y SHA-256, sin correo ni IP en claro", () => {
  it("hashSha256 calcula el SHA-256 hexadecimal canónico", () => {
    expect(hashSha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("el par con IP es 'par_' + sha256(correo|ip)", () => {
    const clave = claveDePar(CORREO, IP);
    expect(clave).toBe(`par_${hashSha256(`${CORREO}|${IP}`)}`);
    expect(clave).not.toContain(CORREO);
    expect(clave).not.toContain(IP);
    expect(clave).not.toContain(CONTRASENA);
  });

  it("el par sin IP es 'correo_' + sha256(correo) (modo degradado)", () => {
    const clave = claveDePar(CORREO, null);
    expect(clave).toBe(`correo_${hashSha256(CORREO)}`);
    expect(clave).not.toContain(CORREO);
  });

  it("la IP sola es 'ip_' + sha256(ip)", () => {
    const clave = claveDeIp(IP);
    expect(clave).toBe(`ip_${hashSha256(IP)}`);
    expect(clave).not.toContain(IP);
  });

  it("claves distintas para IPs distintas y para correos distintos", () => {
    expect(claveDePar(CORREO, IP)).not.toBe(claveDePar(CORREO, "198.51.100.7"));
    expect(claveDePar(CORREO, IP)).not.toBe(claveDePar("beto@x.com", IP));
    expect(claveDeIp(IP)).not.toBe(claveDeIp("198.51.100.7"));
  });
});

// ---------------------------------------------------------------------------
// Repositorio en memoria
// ---------------------------------------------------------------------------

describe("A6 §7 · repositorio en memoria: aplica, persiste y borra", () => {
  it("ejecutar recibe el estado actual, guarda el resultado y leer lo devuelve", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    const primero = await repositorio.ejecutar("k", () => estadoDe(1, AHORA, null));
    expect(primero?.fallos).toBe(1);
    const segundo = await repositorio.ejecutar("k", (actual) => {
      const base = actual ?? estadoDe(0, AHORA, null);
      return estadoDe(base.fallos + 1, AHORA, null);
    });
    expect(segundo?.fallos).toBe(2);
    expect((await repositorio.leer("k"))?.fallos).toBe(2);
  });

  it("ejecutar que devuelve null borra el documento", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    await repositorio.ejecutar("k", () => estadoDe(3, AHORA, null));
    const borrado = await repositorio.ejecutar("k", () => null);
    expect(borrado).toBeNull();
    expect(await repositorio.leer("k")).toBeNull();
  });

  it("un documento inexistente se lee como null", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    expect(await repositorio.leer("no-existe")).toBeNull();
  });

  it("cada clave se guarda por separado", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    await repositorio.ejecutar("a", () => estadoDe(1, AHORA, null));
    await repositorio.ejecutar("b", () => estadoDe(9, AHORA, null));
    expect((await repositorio.leer("a"))?.fallos).toBe(1);
    expect((await repositorio.leer("b"))?.fallos).toBe(9);
  });

  it("leer devuelve una copia: mutarla no cambia lo guardado", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    await repositorio.ejecutar("k", () => estadoDe(2, AHORA, null));
    const leido = await repositorio.leer("k");
    if (leido === null) {
      throw new Error("se esperaba un estado guardado");
    }
    leido.fallos = 99;
    leido.bloqueado_hasta = AHORA.toISOString();
    expect((await repositorio.leer("k"))?.fallos).toBe(2);
    expect((await repositorio.leer("k"))?.bloqueado_hasta).toBeNull();
  });

  it("el estado devuelto por ejecutar es una copia: mutarlo no cambia lo guardado", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    const devuelto = await repositorio.ejecutar("k", () => estadoDe(1, AHORA, null));
    if (devuelto === null) {
      throw new Error("se esperaba un estado guardado");
    }
    devuelto.fallos = 42;
    expect((await repositorio.leer("k"))?.fallos).toBe(1);
  });

  it("dos ejecuciones seguidas no comparten la misma referencia guardada", async () => {
    const repositorio = crearRepositorioIntentosEnMemoria();
    const inicial = estadoDe(1, AHORA, null);
    await repositorio.ejecutar("k", () => inicial);
    inicial.fallos = 77;
    expect((await repositorio.leer("k"))?.fallos).toBe(1);
  });
});
