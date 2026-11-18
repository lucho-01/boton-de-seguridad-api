import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { FechaIsoSchema, PerfilCuentaSchema, RolSchema } from "@/shared/schema";
import { obtenerApp } from "@/shared/server/firebase";
import type { NuevoPerfil, PerfilDocumento, RepositorioPerfil } from "./repository";

/**
 * Repositorio de perfiles en Firestore (spec A1, §7).
 *
 * Ruta `usuarios/{uid}`. Cada documento leído se valida con Zod antes de salir
 * del repositorio. Nunca se registra el correo (dato personal) ni el contenido
 * del documento: los logs solo dicen tipo y ubicación.
 */

/** Colección de perfiles (raíz de todo dato privado de una cuenta). */
export const COLECCION_USUARIOS = "usuarios";

/** Forma exacta del documento `usuarios/{uid}` (spec A1, §7). */
const PerfilDocumentoSchema = z.object({
  email: z.string(),
  rol: RolSchema,
  perfil: PerfilCuentaSchema,
  created_at: FechaIsoSchema,
  updated_at: FechaIsoSchema,
  deleted_at: FechaIsoSchema.nullable(),
});

/** Log de un fallo de Firestore: tipo y ubicación, nunca datos del documento. */
function registrarFallo(ubicacion: string, fallo: object): void {
  const tipo: string = describirTipo(fallo);
  console.error("[firestore] fallo al usar el perfil", { ubicacion, tipo });
}

/** Nombre del tipo del fallo; nunca su mensaje ni datos del documento. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}
/** Valida lo leído de Firestore; si no encaja, se trata como fallo del almacén. */
function validarDocumento(crudo: object): PerfilDocumento {
  return PerfilDocumentoSchema.parse(crudo);
}

/** Implementación real del puerto `RepositorioPerfil`. */
export function crearRepositorioPerfilFirestore(): RepositorioPerfil {
  return {
    async crear(datos: NuevoPerfil): Promise<PerfilDocumento> {
      const documento: PerfilDocumento = {
        email: datos.email,
        rol: datos.rol,
        perfil: datos.perfil,
        created_at: datos.creadoEn,
        updated_at: datos.creadoEn,
        deleted_at: null,
      };
      try {
        const app = await obtenerApp();
        await getFirestore(app).collection(COLECCION_USUARIOS).doc(datos.uid).create(documento);
      } catch (capturado) {
        registrarFallo("crear", capturado!);
        throw capturado!;
      }
      return { ...documento };
    },

    async obtener(uid: string): Promise<PerfilDocumento | null> {
      let instantanea;
      try {
        const app = await obtenerApp();
        instantanea = await getFirestore(app).collection(COLECCION_USUARIOS).doc(uid).get();
      } catch (capturado) {
        registrarFallo("obtener", capturado!);
        throw capturado!;
      }
      if (!instantanea.exists) {
        return null;
      }
      return validarDocumento(instantanea.data() ?? {});
    },

    /**
     * Borra `usuarios/{uid}` y todo lo que cuelga de él (doc + subcolecciones
     * `contacto_confianza` y `alerta`) con el borrado recursivo de Firestore
     * Admin (spec A4, §7; ADR-0010). El subárbol entero pertenece a la cuenta.
     */
    async borrarTodo(uid: string): Promise<void> {
      try {
        const app = await obtenerApp();
        const firestore = getFirestore(app);
        await firestore.recursiveDelete(firestore.collection(COLECCION_USUARIOS).doc(uid));
      } catch (capturado) {
        registrarFallo("borrarTodo", capturado!);
        throw capturado!;
      }
    },
  };
}
