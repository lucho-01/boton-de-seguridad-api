import type { Contacto } from "@/shared/schema";

/**
 * Puerto de persistencia de los contactos de confianza (spec A2, §7; ADR-0008).
 *
 * El `uid` siempre viene de la sesión verificada y lo pone el servicio; el
 * repositorio nunca lo lee de otro sitio. Guarda y consulta; las reglas de
 * negocio (límite, unicidad, borrado lógico) viven en `contactos-service.ts`,
 * que llama a estos métodos dentro de una operación atómica por cuenta.
 *
 * `guardar` actúa como **última barrera** de las reglas que dependen de leer
 * el estado completo de la cuenta (R4 y R5): si el repositorio detecta que la
 * escritura crearía un sexto activo o duplicaría un teléfono, rechaza con
 * `ConflictoDeContactos` para que el servicio lo traduzca a `409`.
 */

/** Motivo por el que el repositorio rechaza una escritura (R4, R5). */
export type MotivoDeConflicto = "limite" | "telefono";

/**
 * Rechazo de `guardar` por una regla que exige ver toda la cuenta. No es un
 * error de dominio HTTP: el servicio lo traduce al `409` con el mensaje de la
 * spec, de modo que el repositorio no conoce textos públicos.
 */
export class ConflictoDeContactos extends Error {
  readonly motivo: MotivoDeConflicto;

  constructor(motivo: MotivoDeConflicto) {
    super(`Conflicto de contactos: ${motivo}`);
    this.name = "ConflictoDeContactos";
    this.motivo = motivo;
  }
}

/** Datos que el servicio entrega para crear o reemplazar un contacto. */
export type DatosGuardado = {
  /** El `id` lo pone el cliente; es la llave del documento (ADR-0003). */
  id: string;
  nombre: string;
  telefono: string;
  parentesco: string | null;
  /** Instante ISO de la escritura; solo se usa al crear (R8). */
  ahora: string;
};

/** Petición de lista paginada por `updated_at` (R10). */
export type ListarContactos = {
  uid: string;
  /** Solo documentos con `updated_at > since`; `null` = todos. */
  since: string | null;
  /** Tope de documentos de la página (`MAXIMO_PAGINA`). */
  limite: number;
};

/** Puerto del repositorio de contactos. */
export type RepositorioContactos = {
  /** Documentos con `updated_at > since`, ordenados ascendente y acotados. */
  listar(peticion: ListarContactos): Promise<Contacto[]>;
  /** Contacto de la cuenta o `null` si no existe (o es de otro usuario). */
  obtener(uid: string, id: string): Promise<Contacto | null>;
  /**
   * Crea o reemplaza el documento completo, restaura si estaba borrado y
   * conserva `created_at` (R6, R7). Lanza `ConflictoDeContactos` si violaría
   * el límite de activos o la unicidad por teléfono.
   */
  guardar(uid: string, datos: DatosGuardado): Promise<Contacto>;
  /** Borrado lógico; `null` si no existía o ya estaba borrado (R9). */
  borrarLogicamente(uid: string, id: string, ahora: string): Promise<Contacto | null>;
};
