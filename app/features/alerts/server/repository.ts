import type { Alerta } from "@/shared/schema";

/**
 * Puerto de persistencia de las alertas (spec A3, §7; ADR-0003, ADR-0009).
 *
 * El `uid` siempre viene de la sesión verificada y lo pone el servicio; el
 * repositorio nunca lo lee de otro sitio. Guarda y consulta; las reglas de
 * negocio (coherencia de la ubicación, hora no futura, resumen mensual) viven
 * en `alertas-service.ts`.
 *
 * No hay límite de alertas por cuenta (R6): `guardar` solo crea o reemplaza y
 * conserva `created_at`; `borrarLogicamente` marca `deleted_at`.
 */

/** Datos que el servicio entrega para crear o reemplazar una alerta. */
export type DatosGuardadoAlerta = {
  /** El `id` lo pone el cliente; es la llave del documento (ADR-0003). */
  id: string;
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
  bateria_pct: number | null;
  estado: "cancelada" | "mensaje_preparado";
  /** Instante en que la app registró la alerta; es su fuente de verdad (R8). */
  creada_en: string;
  /** Instante ISO del servidor para `updated_at` (y `created_at` al crear). */
  ahora: string;
};

/** Petición de lista paginada por `updated_at` (R7). */
export type ListarAlertas = {
  uid: string;
  /** Solo documentos con `updated_at > since`; `null` = todos. */
  since: string | null;
  /** Tope de documentos de la página (`MAXIMO_PAGINA`). */
  limite: number;
  /** Instante inyectado de la petición; solo informativo para el almacén. */
  ahora: string;
};

/** Conteo de alertas no borradas de un mes de Colombia (`YYYY-MM`), R8. */
export type ConteoMes = {
  mes: string;
  total: number;
};

/** Puerto del repositorio de alertas. */
export type RepositorioAlertas = {
  /** Documentos con `updated_at > since`, ordenados ascendente y acotados. */
  listar(peticion: ListarAlertas): Promise<Alerta[]>;
  /**
   * Crea o reemplaza el documento completo, restaura si estaba borrado y
   * conserva `created_at` (R5). Nunca falla por volumen: no hay límite.
   */
  guardar(peticion: { uid: string; alerta: DatosGuardadoAlerta }): Promise<Alerta>;
  /** Borrado lógico; `null` si no existía o ya estaba borrado (R6, R9). */
  borrarLogicamente(peticion: { uid: string; id: string; ahora: string }): Promise<Alerta | null>;
  /**
   * Alertas no borradas con su `creada_en`, en orden de más reciente a más
   * antiguo. El servicio las agrupa por mes de Colombia; el repositorio no
   * conoce la regla horaria.
   */
  listarNoBorradas(peticion: { uid: string }): Promise<Alerta[]>;
};
