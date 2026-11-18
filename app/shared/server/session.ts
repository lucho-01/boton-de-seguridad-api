import type { Sesion } from "@/shared/schema";
import { leerBearer } from "@/shared/server/http";

/**
 * Sesión (spec A0, R3, R4). El puerto permite probar sin red: las pruebas
 * pasan un verificador simulado; en producción lo implementa `firebase.ts`.
 */

/** Puerto mínimo para resolver la identidad de una petición. */
export type VerificadorDeToken = {
  /** Devuelve la sesión del token o lanza `NoAutenticado`. */
  verificar(token: string): Promise<Sesion>;
};

/**
 * Lee el Bearer de la petición y lo verifica. El `uid` sale **solo** del token
 * verificado: nunca del cuerpo, la query ni la URL.
 */
export async function requiereSesion(
  peticion: Request,
  verificador: VerificadorDeToken,
): Promise<Sesion> {
  const token = leerBearer(peticion);
  return verificador.verificar(token);
}
