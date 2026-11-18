import { getFirestore } from "firebase-admin/firestore";
import { type EstadoAdmin, EstadoAdminSchema } from "@/shared/schema";
import { obtenerApp } from "@/shared/server/firebase";
import type { RepositorioAdmin } from "./admin-repository";
import { COLECCION_USUARIOS } from "./repository.firestore";

/**
 * Repositorio de diagnóstico en Firestore (spec A5, §7; ADR-0011).
 *
 * Solo agregaciones: `count()` sobre `usuarios`, `collectionGroup` de
 * `contacto_confianza` y de `alerta`. No se lee ningún documento completo, así
 * que no hay datos personales que validar; el resultado agregado se valida con
 * `EstadoAdminSchema` antes de salir. Nunca se registra un `uid`, un teléfono ni
 * unas coordenadas: un fallo solo deja tipo y ubicación (R7).
 */

/**
 * Subcolecciones contadas. Se replican aquí los nombres de las features A2 y
 * A3 porque una feature no importa el `server/` de otra; el contenedor no
 * interviene porque no hay lógica cruzada, solo la raíz `usuarios` compartida.
 */
export const COLECCION_CONTACTOS_DIAGNOSTICO = "contacto_confianza";

/** Subcolección de alertas dentro de `usuarios/{uid}` (spec A3, §7). */
export const COLECCION_ALERTAS_DIAGNOSTICO = "alerta";

/** Log de un fallo de Firestore: tipo y ubicación, nunca datos de documentos. */
function registrarFallo(ubicacion: string, fallo: object): void {
  const tipo = describirTipo(fallo);
  console.error("[firestore] fallo al contar el estado", { ubicacion, tipo });
}

/** Nombre del tipo del fallo; nunca su mensaje ni datos personales. */
function describirTipo(fallo: object): string {
  if (fallo instanceof Error) {
    return fallo.name;
  }
  return typeof fallo;
}

/** Consulta de agregación con un único `count`, tal como la devuelve `count()`. */
type ConsultaConConteo = {
  get(): Promise<{ data(): { count: number } }>;
};

/** Ejecuta el `count` de una consulta y devuelve el número. */
async function contar(consulta: ConsultaConConteo): Promise<number> {
  const instantanea = await consulta.get();
  return instantanea.data().count;
}

/** Implementación real del puerto `RepositorioAdmin`. */
export function crearRepositorioAdminFirestore(): RepositorioAdmin {
  return {
    async contar(): Promise<EstadoAdmin> {
      let estado: object;
      try {
        const app = await obtenerApp();
        const firestore = getFirestore(app);
        const [cuentas, contactos, alertas] = await Promise.all([
          contar(firestore.collection(COLECCION_USUARIOS).count()),
          contar(firestore.collectionGroup(COLECCION_CONTACTOS_DIAGNOSTICO).count()),
          contar(firestore.collectionGroup(COLECCION_ALERTAS_DIAGNOSTICO).count()),
        ]);
        estado = { cuentas, contactos, alertas };
      } catch (capturado) {
        registrarFallo("contar", capturado!);
        throw capturado!;
      }
      return EstadoAdminSchema.parse(estado);
    },
  };
}
