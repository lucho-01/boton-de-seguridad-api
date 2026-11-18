import { isIP } from "node:net";
import { servicios } from "@/features/container";
import { type Login, LoginSchema } from "@/shared/schema";
import { leerJson, manejar, responderJson } from "@/shared/server/http";

/**
 * `POST /api/auth/login` (spec A1, §3; criterios 6–9; spec A6, R3 y R7).
 *
 * Público y solo JSON. El servicio responde el mismo 401 exista o no el
 * correo, traduce los códigos de Firebase (403 deshabilitada) y aplica el
 * límite propio de intentos (429).
 *
 * Origen de la IP: `x-real-ip` la fija el borde de Vercel y se prefiere porque
 * el cliente no puede sobrescribirla. Si falta, se toma el **último** salto de
 * `x-forwarded-for`, que es el que añade el proxy de confianza; los saltos de
 * la izquierda los controla el cliente. Solo se aceptan direcciones válidas
 * (`node:net.isIP`): cualquier otra cosa se descarta y el límite cae al modo
 * degradado por correo. La IP nunca se registra.
 */

export const runtime = "nodejs";

/** Máximo de una dirección IPv6 con corchetes, sin puerto. */
const MAXIMO_IP = 45;

/** Quita el puerto de una dirección con forma `1.2.3.4:5678` o `[::1]:1234`. */
function sinPuerto(valor: string): string {
  if (valor.startsWith("[")) {
    const fin = valor.indexOf("]");
    if (fin > 0) {
      return valor.slice(1, fin);
    }
    return valor;
  }
  const partes = valor.split(":");
  if (partes.length === 2) {
    return partes[0] ?? valor;
  }
  return valor;
}

/** `true` si `valor` es una dirección IPv4 o IPv6 válida, ya sin puerto. */
function esDireccion(valor: string): boolean {
  return isIP(valor) !== 0;
}

/**
 * Dirección utilizable de una cabecera: sin espacios ni puerto, con formato de
 * IP y longitud razonable. Cualquier otro valor devuelve `null`.
 */
function comoIp(valor: string): string | null {
  const ip = sinPuerto(valor.trim());
  if (ip.length === 0 || ip.length > MAXIMO_IP) {
    return null;
  }
  if (!esDireccion(ip)) {
    return null;
  }
  return ip;
}

/** Último salto de `x-forwarded-for`: el que añade el proxy de confianza. */
function ultimaIp(cabecera: string | null): string | null {
  if (cabecera === null) {
    return null;
  }
  const partes = cabecera.split(",");
  const ultima = partes[partes.length - 1] ?? "";
  return comoIp(ultima);
}

/** IP del cliente según el borde de Vercel; `null` si no hay una válida. */
function leerIp(peticion: Request): string | null {
  const real = comoIp(peticion.headers.get("x-real-ip") ?? "");
  if (real !== null) {
    return real;
  }
  return ultimaIp(peticion.headers.get("x-forwarded-for"));
}

export const POST = manejar(async function login(peticion: Request): Promise<Response> {
  const datos: Login = await leerJson(peticion, LoginSchema);
  const cuenta = await servicios.cuentas.iniciarSesion(datos, { ip: leerIp(peticion) });
  return responderJson(cuenta, 200);
});
