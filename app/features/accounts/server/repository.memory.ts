import type { NuevoPerfil, PerfilDocumento, RepositorioPerfil } from "./repository";

/**
 * Repositorio de perfiles en memoria (spec A1, §9): permite probar el registro
 * y el rollback sin Firestore. Cada instancia es un mapa propio, así que dos
 * pruebas nunca comparten estado.
 */

/** Constructor del doble: un mapa privado por instancia. */
export function crearRepositorioPerfilEnMemoria(): RepositorioPerfil {
  const documentos = new Map<string, PerfilDocumento>();

  return {
    async crear(datos: NuevoPerfil): Promise<PerfilDocumento> {
      if (documentos.has(datos.uid)) {
        throw new Error("El perfil ya existe");
      }
      const documento: PerfilDocumento = {
        email: datos.email,
        rol: datos.rol,
        perfil: datos.perfil,
        created_at: datos.creadoEn,
        updated_at: datos.creadoEn,
        deleted_at: null,
      };
      documentos.set(datos.uid, documento);
      return { ...documento };
    },

    async obtener(uid: string): Promise<PerfilDocumento | null> {
      const documento = documentos.get(uid);
      if (documento === undefined) {
        return null;
      }
      return { ...documento };
    },

    /**
     * Borra el perfil del mapa (spec A4, §7). El doble no modela
     * subcolecciones: en Firestore el mismo subárbol se borra de forma
     * recursiva, pero aquí solo existe el documento del perfil. Borrar un
     * `uid` ausente también termina bien (idempotente).
     */
    async borrarTodo(uid: string): Promise<void> {
      documentos.delete(uid);
    },
  };
}
