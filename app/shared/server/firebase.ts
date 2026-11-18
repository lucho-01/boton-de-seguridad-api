import { type App, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import { type Sesion, SesionSchema } from "@/shared/schema";
import { obtenerEntorno } from "@/shared/server/env";
import { NoAutenticado } from "@/shared/server/errors";

/**
 * Firebase Admin (ADR-0002, spec A0). Nadie más construye clientes de Firebase:
 * la inicialización es perezosa y nombrada para sobrevivir a las recargas de
 * Next. Cualquier fallo del verificador se traduce al mismo 401 (R4) y nunca
 * se registra el token ni la clave.
 */

/** Nombre fijo de la app de Admin: evita choques si el módulo se evalúa dos veces. */
export const NOMBRE_APP_FIREBASE = "boton-de-seguridad-api";

const MENSAJE_TOKEN = "Sesión inválida o vencida";
const SIN_PILA = "sin pila";

/** Inicialización en curso: dos peticiones en frío comparten la misma promesa. */
let appEnCurso: Promise<App> | null = null;

/** Log de un fallo de Firebase: tipo y ubicación, nunca su mensaje. */
function resumirError(error: Error | object): { tipo: string; ubicacion: string } {
  if (!(error instanceof Error)) {
    return { tipo: typeof error, ubicacion: SIN_PILA };
  }
  if (error.stack === undefined) {
    return { tipo: error.name, ubicacion: SIN_PILA };
  }
  const lineas = error.stack.split("\n");
  return { tipo: error.name, ubicacion: lineas[1]?.trim() ?? SIN_PILA };
}

/** Devuelve la app de Admin, creándola una sola vez por proceso. */
export function obtenerApp(): Promise<App> {
  const existente = getApps().find((app) => app.name === NOMBRE_APP_FIREBASE);
  if (existente !== undefined) {
    return Promise.resolve(existente);
  }
  if (appEnCurso === null) {
    appEnCurso = crearApp();
  }
  return appEnCurso;
}

async function crearApp(): Promise<App> {
  let app: App;
  try {
    const entorno = obtenerEntorno();
    app = initializeApp(
      {
        credential: cert({
          projectId: entorno.FIREBASE_PROJECT_ID,
          clientEmail: entorno.FIREBASE_CLIENT_EMAIL,
          privateKey: entorno.FIREBASE_PRIVATE_KEY,
        }),
        projectId: entorno.FIREBASE_PROJECT_ID,
      },
      NOMBRE_APP_FIREBASE,
    );
  } catch (capturado) {
    appEnCurso = null;
    console.error("[firebase] no se pudo inicializar Admin", resumirError(capturado!));
    throw new NoAutenticado(MENSAJE_TOKEN);
  }
  return app;
}

/** Rol a partir del custom claim `rol`; cualquier otro valor es `usuario`. */
export function rolDelToken(tokens: DecodedIdToken): Sesion["rol"] {
  if (tokens.rol === "admin") {
    return "admin";
  }
  return "usuario";
}

/** Convierte el token decodificado en la sesión del contrato (`SesionSchema`). */
export function sesionDelToken(tokens: DecodedIdToken): Sesion {
  const crudo = {
    uid: tokens.uid,
    email: tokens.email,
    rol: rolDelToken(tokens),
  };
  return SesionSchema.parse(crudo);
}

/**
 * Verifica un ID token del proyecto. Cualquier fallo (vencido, firma, emisor,
 * revocado, falta de configuración) responde el mismo 401 (R4).
 */
export async function verificarIdToken(token: string): Promise<Sesion> {
  let decodificado: DecodedIdToken;
  try {
    const app = await obtenerApp();
    decodificado = await getAuth(app).verifyIdToken(token);
  } catch (capturado) {
    console.error("[auth] token rechazado", resumirError(capturado!));
    throw new NoAutenticado(MENSAJE_TOKEN);
  }
  try {
    return sesionDelToken(decodificado);
  } catch (capturado) {
    console.error("[auth] token sin los campos esperados", resumirError(capturado!));
    throw new NoAutenticado(MENSAJE_TOKEN);
  }
}

/** API de autenticación ya inicializada (la usará A1 para crear cuentas). */
export async function obtenerAuth(): Promise<Auth> {
  const app = await obtenerApp();
  return getAuth(app);
}
