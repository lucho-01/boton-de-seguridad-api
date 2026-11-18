import {
  type Alerta,
  AlertaSchema,
  type AlertaEscritura,
  AlertaEscrituraSchema,
  type MesResumen,
  MAXIMO_PAGINA,
  type Ok,
  OkSchema,
  type RespuestaAlertas,
  RespuestaAlertasSchema,
  type ResumenAlertas,
  ResumenAlertasSchema,
  type Sesion,
} from "@/shared/schema";
import { ErrorDeValidacion, NoEncontrado } from "@/shared/server/errors";
import { aIso, type Reloj } from "@/shared/server/time";
import type { ConteoMes, RepositorioAlertas } from "./repository";

/**
 * Reglas de negocio de las alertas (spec A3, §4, §6, §8; ADR-0009).
 *
 * El `uid` sale siempre de la sesión verificada; el `id` y el cuerpo los valida
 * la ruta con Zod (`IdRutaSchema`, `AlertaEscrituraSchema`) antes de llegar
 * aquí. El servicio recibe ya los datos con el contrato de escritura y decide el
 * tiempo con el reloj inyectado.
 *
 * Los rangos de `lat`, `lng`, `precision_m` y `bateria_pct` los acota el
 * contrato en la frontera. El servicio aplica además la regla de negocio R2
 * (ubicación todo o nada) y R4 (hora no futura) con el reloj, porque son reglas
 * y no formatos.
 *
 * Los mensajes 4xx son literales del dominio (R2, R4, §6) y no incluyen
 * coordenadas, batería ni ids. Un fallo de almacén no se traduce: sube hasta
 * `manejar`, que responde `500` opaco y registra tipo y ubicación.
 */

/** Mensajes literales de los 400/404 de la spec A3 (§6). */
export const MENSAJES_ALERTA = {
  ubicacion: "Coordenadas incompletas o fuera de rango",
  horaFutura: "La hora de la alerta no puede ser futura",
  horaAntigua: "La hora de la alerta es demasiado antigua",
  noEncontrado: "Alerta no encontrada",
} as const;

/** Margen de reloj tolerado para `creada_en` en el futuro (R4): 5 minutos. */
const MARGEN_FUTURO_MS = 5 * 60 * 1000;

/** Instante mínimo aceptado para `creada_en`: 1 de enero de 2026 (R4). */
export const INSTANTE_MINIMO = Date.parse("2026-01-01T00:00:00.000Z");

/** Año mínimo posible tras restar el desfase; nunca sale una etiqueta inválida. */
const ANIO_MINIMO_ETIQUETA = 1900;

/** Campos que forman la ubicación; deben venir todos o ninguno (R2). */
const CAMPOS_UBICACION = ["lat", "lng", "precision_m"] as const;

/** Dependencias del servicio, todas inyectadas. */
export type DependenciasAlertas = {
  repositorio: RepositorioAlertas;
  reloj: Reloj;
};

/** Cara del servicio que usan las rutas. */
export type ServicioAlertas = {
  listar(sesion: Sesion, since?: string): Promise<RespuestaAlertas>;
  guardar(sesion: Sesion, id: string, datos: AlertaEscritura): Promise<Alerta>;
  borrar(sesion: Sesion, id: string): Promise<Ok>;
  resumen(sesion: Sesion): Promise<ResumenAlertas>;
};

/** Datos de ubicación tal como llegan: pueden faltar o venir en `null`. */
type UbicacionRecibida = {
  lat?: number | null;
  lng?: number | null;
  precision_m?: number | null;
};

/** Ubicación ya normalizada al contrato del cable. */
type Ubicacion = {
  lat: number | null;
  lng: number | null;
  precision_m: number | null;
};

const UBICACION_VACIA: Ubicacion = { lat: null, lng: null, precision_m: null };

/** `true` si el campo llegó con un valor (no ausente ni `null`). */
function tieneValor(valor: number | null | undefined): boolean {
  if (valor === undefined) {
    return false;
  }
  if (valor === null) {
    return false;
  }
  return true;
}

/**
 * R2: la ubicación es todo o nada. Sin ningún valor → todo `null`; con valores
 * parciales → `400` con el detalle en el primer campo ausente (o en `lat` si
 * es `lat` el que falta).
 */
function normalizarUbicacion(datos: UbicacionRecibida): Ubicacion {
  let conValor = 0;
  for (const campo of CAMPOS_UBICACION) {
    if (tieneValor(datos[campo])) {
      conValor += 1;
    }
  }
  if (conValor === 0) {
    return UBICACION_VACIA;
  }
  for (const campo of CAMPOS_UBICACION) {
    if (!tieneValor(datos[campo])) {
      throw new ErrorDeValidacion([{ campo, mensaje: MENSAJES_ALERTA.ubicacion }]);
    }
  }
  return {
    lat: datos.lat ?? null,
    lng: datos.lng ?? null,
    precision_m: datos.precision_m ?? null,
  };
}

/** R4: `creada_en` no puede superar el reloj en más de 5 minutos. */
function validarHoraNoFutura(creadaEn: string, ahora: Date): void {
  const instante = Date.parse(creadaEn);
  if (instante < INSTANTE_MINIMO) {
    throw new ErrorDeValidacion([{ campo: "creada_en", mensaje: MENSAJES_ALERTA.horaAntigua }]);
  }
  if (instante - ahora.getTime() > MARGEN_FUTURO_MS) {
    throw new ErrorDeValidacion([{ campo: "creada_en", mensaje: MENSAJES_ALERTA.horaFutura }]);
  }
}

/** Desfase de Colombia en horas (ADR-0009: UTC-5, sin horario de verano). */
const DESFASE_COLOMBIA_HORAS = 5;

/** `YYYY-MM` con año de 4 dígitos y mes de 2. */
function etiquetaMes(anio: number, mes: number): string {
  return `${String(anio).padStart(4, "0")}-${String(mes).padStart(2, "0")}`;
}

/** Mes calendario anterior a `anio`/`mes`, pasando de enero al diciembre previo. */
function mesAnterior(anio: number, mes: number): string {
  if (mes > 1) {
    return etiquetaMes(anio, mes - 1);
  }
  return etiquetaMes(anio - 1, 12);
}

/**
 * Mes de Colombia (`YYYY-MM`) de un instante ISO UTC (R8, ADR-0009). Función
 * pura: el mes calendario de `YYYY-MM-DDThh:mm` es aritmética sobre la cadena
 * (`hh` se resta 5 y, si queda negativo, se reajusta al día anterior). Así el
 * resultado no depende de la zona horaria del servidor ni de ninguna fecha.
 */
export function mesEnColombia(iso: string): string {
  const anio = Number(iso.slice(0, 4));
  if (anio < ANIO_MINIMO_ETIQUETA) {
    // Defensa en profundidad: la frontera ya rechaza estas fechas. Un documento
    // heredado no debe romper el resumen de toda la cuenta.
    return etiquetaMes(ANIO_MINIMO_ETIQUETA, 1);
  }
  const mes = Number(iso.slice(5, 7));
  const dia = Number(iso.slice(8, 10));
  const hora = Number(iso.slice(11, 13));
  const horaColombia = hora - DESFASE_COLOMBIA_HORAS;
  if (horaColombia >= 0) {
    return etiquetaMes(anio, mes);
  }
  if (dia > 1) {
    return etiquetaMes(anio, mes);
  }
  return mesAnterior(anio, mes);
}

/** Agrupa alertas no borradas por mes de Colombia, de reciente a antiguo (R8). */
function agruparPorMes(alertas: Alerta[]): MesResumen[] {
  const totales = new Map<string, number>();
  for (const alerta of alertas) {
    const mes = mesEnColombia(alerta.creada_en);
    totales.set(mes, (totales.get(mes) ?? 0) + 1);
  }
  const conteos: ConteoMes[] = [];
  for (const [mes, total] of totales) {
    conteos.push({ mes, total });
  }
  conteos.sort(compararMeses);
  return conteos;
}

/** Mes más reciente primero; a igualdad (imposible con un mapa), estable. */
function compararMeses(a: ConteoMes, b: ConteoMes): number {
  if (a.mes > b.mes) {
    return -1;
  }
  if (a.mes < b.mes) {
    return 1;
  }
  return 0;
}

/** Crea el servicio con sus dependencias (spec A3, §4). */
export function crearServicioAlertas(dependencias: DependenciasAlertas): ServicioAlertas {
  const { repositorio, reloj } = dependencias;

  async function listar(sesion: Sesion, since?: string): Promise<RespuestaAlertas> {
    const cursor: string | null = since ?? null;
    const items = await repositorio.listar({
      uid: sesion.uid,
      since: cursor,
      limite: MAXIMO_PAGINA,
      ahora: aIso(reloj.ahora()),
    });
    return RespuestaAlertasSchema.parse({ items, servidor_ahora: aIso(reloj.ahora()) });
  }

  async function guardar(
    sesion: Sesion,
    id: string,
    datosRecibidos: AlertaEscritura,
  ): Promise<Alerta> {
    const ahora = reloj.ahora();
    const datos = AlertaEscrituraSchema.parse(datosRecibidos);
    const ubicacion = normalizarUbicacion(datos);
    validarHoraNoFutura(datos.creada_en, ahora);
    const guardada = await repositorio.guardar({
      uid: sesion.uid,
      alerta: {
        id,
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        precision_m: ubicacion.precision_m,
        bateria_pct: datos.bateria_pct,
        estado: datos.estado,
        creada_en: datos.creada_en,
        ahora: aIso(ahora),
      },
    });
    return AlertaSchema.parse(guardada);
  }

  async function borrar(sesion: Sesion, id: string): Promise<Ok> {
    const borrada = await repositorio.borrarLogicamente({
      uid: sesion.uid,
      id,
      ahora: aIso(reloj.ahora()),
    });
    if (borrada === null) {
      throw new NoEncontrado(MENSAJES_ALERTA.noEncontrado);
    }
    return OkSchema.parse({ ok: true });
  }

  async function resumen(sesion: Sesion): Promise<ResumenAlertas> {
    const alertas = await repositorio.listarNoBorradas({ uid: sesion.uid });
    const meses = agruparPorMes(alertas);
    let total = 0;
    for (const conteo of meses) {
      total += conteo.total;
    }
    return ResumenAlertasSchema.parse({ meses, total });
  }

  return { listar, guardar, borrar, resumen };
}
