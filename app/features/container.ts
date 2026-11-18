import { crearRepositorioAdminFirestore } from "@/features/accounts/server/admin-repository.firestore";
import { crearServicioAdmin, type ServicioAdmin } from "@/features/accounts/server/admin-service";
import {
  crearServicioCuentas,
  type ServicioCuentas,
} from "@/features/accounts/server/cuentas-service";
import { crearRepositorioPerfilFirestore } from "@/features/accounts/server/repository.firestore";
import { crearServicioIntentos } from "@/features/accounts/server/intentos-service";
import { crearRepositorioIntentosFirestore } from "@/features/accounts/server/intentos-repository.firestore";
import {
  crearServicioAlertas,
  type ServicioAlertas,
} from "@/features/alerts/server/alertas-service";
import { crearRepositorioAlertasFirestore } from "@/features/alerts/server/repository.firestore";
import {
  crearServicioContactos,
  type ServicioContactos,
} from "@/features/contacts/server/contactos-service";
import { crearRepositorioContactosFirestore } from "@/features/contacts/server/repository.firestore";
import { clienteAuthRest } from "@/shared/server/auth-rest";
import { verificarIdToken } from "@/shared/server/firebase";
import type { VerificadorDeToken } from "@/shared/server/session";
import { type Reloj, relojDelSistema } from "@/shared/server/time";

/**
 * Raíz de composición (spec A0, §7; spec A1, §11; spec A2, §11).
 *
 * Las rutas llegan a la lógica solo por aquí. A0 conecta el reloj y el
 * verificador de token; A1 conecta el repositorio de perfiles (Firestore), el
 * cliente de Firebase Auth REST y el servicio de cuentas; A2 conecta el
 * repositorio de contactos (Firestore) y su servicio; A3 conecta el repositorio
 * de alertas (Firestore) y el suyo. A4 añade el borrado de cuenta reutilizando
 * el servicio de cuentas, sin cambiar cómo dependen las rutas. A5 conecta el
 * repositorio de diagnóstico (Firestore) y su servicio; la ruta `admin` exige
 * el claim `rol = "admin"` verificado en el token.
 */

/** Reloj del sistema, inyectado en los servicios para que el tiempo no sea global. */
export const reloj: Reloj = relojDelSistema;

/** Verificador real: Firebase Admin, inicializado de forma perezosa. */
export const verificadorDeToken: VerificadorDeToken = {
  verificar(token: string) {
    return verificarIdToken(token);
  },
};

/** Repositorio real de perfiles: solo accesible desde el servidor (ADR-0002). */
export const repositorioPerfil = crearRepositorioPerfilFirestore();

/** Repositorio real de contadores de intentos de login (spec A6, ADR-0012). */
export const repositorioIntentos = crearRepositorioIntentosFirestore();

/** Repositorio real de contactos de confianza (spec A2, ADR-0008). */
export const repositorioContactos = crearRepositorioContactosFirestore();

/** Repositorio real de alertas (spec A3, ADR-0009). */
export const repositorioAlertas = crearRepositorioAlertasFirestore();

/** Repositorio real de diagnóstico: solo agregaciones (spec A5, ADR-0011). */
export const repositorioAdmin = crearRepositorioAdminFirestore();

/** Límite propio de intentos de login (spec A6). */
const intentos = crearServicioIntentos({ repositorio: repositorioIntentos, reloj });

/** Servicio de cuentas de A1: registro, login, refresh y `yo`. */
const cuentas: ServicioCuentas = crearServicioCuentas({
  clienteAuth: clienteAuthRest,
  repositorio: repositorioPerfil,
  verificador: verificadorDeToken,
  reloj,
  intentos,
});

/** Servicio de contactos de A2: listar, guardar y borrar lógicamente. */
const contactos: ServicioContactos = crearServicioContactos({
  repositorio: repositorioContactos,
  reloj,
});

/** Servicio de alertas de A3: sincronizar, guardar, borrar y resumen por mes. */
const alertas: ServicioAlertas = crearServicioAlertas({
  repositorio: repositorioAlertas,
  reloj,
});

/** Servicio de diagnóstico de A5: totales agregados solo para `admin`. */
const admin: ServicioAdmin = crearServicioAdmin({ repositorio: repositorioAdmin });

/** Servicios de negocio que exponen las rutas. */
export const servicios = { cuentas, contactos, alertas, admin };

export type Servicios = typeof servicios;
