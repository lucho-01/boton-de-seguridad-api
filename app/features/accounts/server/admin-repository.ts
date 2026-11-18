import type { EstadoAdmin } from "@/shared/schema";

/**
 * Puerto de persistencia del diagnóstico (spec A5, §7; ADR-0011).
 *
 * A5 no lee documentos: solo pide tres totales agregados. El repositorio los
 * cuenta con las consultas de agregación del Admin SDK y no conoce reglas de
 * acceso; la autorización por rol vive en `admin-service.ts`.
 *
 * Rutas contadas (spec A5, §7):
 * ```text
 * usuarios/*                                  → cuentas
 * collectionGroup("contacto_confianza")/*     → contactos
 * collectionGroup("alerta")/*                 → alertas
 * ```
 *
 * Los totales incluyen documentos con borrado lógico: el diagnóstico mide
 * volumen almacenado, no datos vigentes (R3).
 */

/** Puerto del repositorio de diagnóstico: tres totales agregados. */
export type RepositorioAdmin = {
  /** Cuenta cuentas, contactos y alertas de todo el sistema. */
  contar(): Promise<EstadoAdmin>;
};
