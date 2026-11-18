import { createHash } from "node:crypto";
import type { Login } from "@/shared/schema";
import { DemasiadosIntentos, ErrorInterno } from "@/shared/server/errors";
import type { Reloj } from "@/shared/server/time";
import {
  MENSAJE_LIMITE,
  UMBRAL_IP,
  UMBRAL_PAR,
  type EstadoIntentos,
  estaBloqueado,
  estadoTrasFallo,
} from "./intentos";
import type { RepositorioIntentos } from "./intentos-repository";

/**
 * Límite de intentos de login (spec A6, R1–R11; ADR-0012).
 *
 * El servicio decide cuándo un fallo suma, bloquea o reinicia; el repositorio
 * solo persiste. Las claves son hashes con prefijo: nunca se guarda el correo,
 * la IP ni la contraseña en claro. Si el almacén falla al verificar o al
 * registrar un fallo se responde 500 (no se salta el límite); si falla al
 * reiniciar tras un éxito, solo se registra y el login sigue.
 */

/** Contexto HTTP del login: la IP del cliente, si se pudo leer. */
export type ContextoLogin = {
  ip: string | null;
};

/** Cara del límite que usa el servicio de cuentas. */
export type ServicioIntentos = {
  /** Lanza `DemasiadosIntentos` (429) si el par o la IP están bloqueados. */
  verificar(datos: Login, ip: string | null): Promise<void>;
  /** Suma un fallo de credenciales al par y a la IP. */
  registrarFallo(datos: Login, ip: string | null): Promise<void>;
  /** Borra ambos contadores tras un login correcto. */
  reiniciar(datos: Login, ip: string | null): Promise<void>;
};

/** Dependencias del servicio, todas inyectadas. */
export type DependenciasIntentos = {
  repositorio: RepositorioIntentos;
  reloj: Reloj;
};

/** SHA-256 hexadecimal de un texto; identificador opaco de correo o IP (R6). */
export function hashSha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/** Clave del contador del par: `par_` con IP o `correo_` en modo degradado (R7). */
export function claveDePar(correo: string, ip: string | null): string {
  if (ip === null) {
    return `correo_${hashSha256(correo)}`;
  }
  return `par_${hashSha256(`${correo}|${ip}`)}`;
}

/** Clave del contador de la IP sola (R2). */
export function claveDeIp(ip: string): string {
  return `ip_${hashSha256(ip)}`;
}

/** Claves de un intento: el par siempre; la IP solo si se conoce. */
type Claves = {
  par: string;
  ip: string | null;
};

function clavesDe(datos: Login, ip: string | null): Claves {
  if (ip === null) {
    return { par: claveDePar(datos.email, null), ip: null };
  }
  return { par: claveDePar(datos.email, ip), ip: claveDeIp(ip) };
}

/** Nombre del tipo del fallo para logs; nunca su mensaje ni datos personales. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Crea el servicio del límite con el almacén y el reloj inyectados. */
export function crearServicioIntentos(dependencias: DependenciasIntentos): ServicioIntentos {
  const { repositorio, reloj } = dependencias;

  async function verificar(datos: Login, ip: string | null): Promise<void> {
    const claves = clavesDe(datos, ip);
    let delPar: EstadoIntentos | null;
    let deLaIp: EstadoIntentos | null;
    try {
      if (claves.ip === null) {
        delPar = await repositorio.leer(claves.par);
        deLaIp = null;
      } else {
        [delPar, deLaIp] = await Promise.all([
          repositorio.leer(claves.par),
          repositorio.leer(claves.ip),
        ]);
      }
    } catch (capturado) {
      console.error("[intentos] no se pudo leer el contador de login", {
        tipo: describirTipo(capturado!),
      });
      throw new ErrorInterno();
    }
    const ahora = reloj.ahora();
    if (estaBloqueado(delPar, ahora) || estaBloqueado(deLaIp, ahora)) {
      throw new DemasiadosIntentos(MENSAJE_LIMITE);
    }
  }

  async function registrarFallo(datos: Login, ip: string | null): Promise<void> {
    const claves = clavesDe(datos, ip);
    const ahora = reloj.ahora();
    try {
      await repositorio.ejecutar(claves.par, (actual) => {
        return estadoTrasFallo(actual, ahora, UMBRAL_PAR);
      });
      if (claves.ip !== null) {
        await repositorio.ejecutar(claves.ip, (actual) => {
          return estadoTrasFallo(actual, ahora, UMBRAL_IP);
        });
      }
    } catch (capturado) {
      console.error("[intentos] no se pudo registrar el fallo de login", {
        tipo: describirTipo(capturado!),
      });
      throw new ErrorInterno();
    }
  }

  async function reiniciar(datos: Login, ip: string | null): Promise<void> {
    const claves = clavesDe(datos, ip);
    try {
      await repositorio.ejecutar(claves.par, () => null);
      if (claves.ip !== null) {
        await repositorio.ejecutar(claves.ip, () => null);
      }
    } catch (capturado) {
      // No se castiga a quien acertó: los contadores caducan solos (R11).
      console.error("[intentos] no se pudo reiniciar el contador de login", {
        tipo: describirTipo(capturado!),
      });
    }
  }

  return { verificar, registrarFallo, reiniciar };
}
