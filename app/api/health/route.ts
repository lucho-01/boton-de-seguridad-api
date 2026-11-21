import { type Salud, SaludSchema, SERVICIO_API, VERSION_API } from "@/shared/schema";
import { evaluarEntornoActual } from "@/shared/server/env";
import { manejar, responderJson } from "@/shared/server/http";

/**
 * `GET /api/health` (spec A0, R7; criterios 4 y 5).
 *
 * Público: no verifica token ni toca Firestore, así que responde muy por
 * debajo de 500 ms. Si falta configuración no es un 500 — el proceso está vivo
 * — sino `200` con `ok: false`; `servicio` identifica siempre esta API.
 */

export const runtime = "nodejs";

// La salud depende del entorno del proceso en ejecución, no del de la compilación:
// sin esto Next podría hornear la respuesta en `next build` (informe de seguridad A0).
export const dynamic = "force-dynamic";

export function estadoDeSalud(entornoCompleto: boolean): Salud {
  return SaludSchema.parse({
    ok: entornoCompleto,
    servicio: SERVICIO_API,
    version: VERSION_API,
  });
}

export const GET = manejar(function salud(): Response {
  const evaluacion = evaluarEntornoActual();
  const cuerpo = estadoDeSalud(evaluacion.estaCompleto);
  return responderJson(cuerpo, 200);
});
