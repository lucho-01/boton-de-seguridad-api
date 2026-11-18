import type { PerfilCuenta, Rol } from "@/shared/schema";

/**
 * Puerto de persistencia del perfil de cuenta (spec A1, §7; ADR-0007).
 *
 * Firestore se usa solo desde el servidor. El repositorio guarda y consulta;
 * las reglas de negocio viven en `cuentas-service.ts`. Las fechas se guardan
 * ya como ISO 8601 UTC, puestas por el servicio con el reloj inyectado.
 */

/** Documento `usuarios/{uid}` tal como vive en Firestore (spec A1, §7). */
export type PerfilDocumento = {
  email: string;
  rol: Rol;
  perfil: PerfilCuenta;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/** Datos para crear el perfil; el `uid` es la llave del documento. */
export type NuevoPerfil = {
  uid: string;
  email: string;
  rol: Rol;
  perfil: PerfilCuenta;
  creadoEn: string;
};

/** Puerto del repositorio de perfiles. */
export type RepositorioPerfil = {
  /** Crea el perfil de la cuenta. Falla si ya existe. */
  crear(datos: NuevoPerfil): Promise<PerfilDocumento>;
  /** Devuelve el perfil o `null` si la cuenta no lo tiene. */
  obtener(uid: string): Promise<PerfilDocumento | null>;
  /**
   * Borra **físicamente** el subárbol completo `usuarios/{uid}`: el documento
   * del perfil y sus subcolecciones `contacto_confianza` y `alerta` (spec A4,
   * §7; ADR-0010). Todo ese subárbol pertenece a la cuenta, así que el borrado
   * no conoce las features de contactos ni de alertas: no hay dependencias
   * cruzadas, solo una raíz común. Es idempotente: si ya no queda nada,
   * termina bien.
   */
  borrarTodo(uid: string): Promise<void>;
};
