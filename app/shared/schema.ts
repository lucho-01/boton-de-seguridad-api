import { z } from "zod";

/**
 * Contrato común de la API (campos en `snake_case`).
 * Lo fija el orquestador; las features usan estos esquemas y no los redefinen.
 */

/** Roles posibles de una cuenta. `admin` llega como custom claim `rol`. */
export const RolSchema = z.enum(["usuario", "admin"]);
export type Rol = z.infer<typeof RolSchema>;

/** Detalle de un campo que no pasó la validación. */
export const DetalleErrorSchema = z.object({
  campo: z.string(),
  mensaje: z.string(),
});
export type DetalleError = z.infer<typeof DetalleErrorSchema>;

/** Cuerpo uniforme de error: `{ error, detalles? }`. */
export const ErrorHttpSchema = z.object({
  error: z.string(),
  detalles: z.array(DetalleErrorSchema).optional(),
});
export type ErrorHttp = z.infer<typeof ErrorHttpSchema>;

/** Respuesta de `DELETE`: `{ ok: true }`. */
export const OkSchema = z.object({
  ok: z.literal(true),
});
export type Ok = z.infer<typeof OkSchema>;

/** Fecha ISO 8601 UTC (p. ej. `2026-11-14T08:00:00.000Z`). */
export const FechaIsoSchema = z.iso.datetime({ offset: false });

/** Identificador generado por el cliente (UUID). */
export const IdSchema = z.uuid();

/** Id de recurso en la URL: si no es UUID, la ruta es inexistente (A2, §6). */
export const IdRutaSchema = z.uuid();

/** Nombre de contacto de confianza (A2, R1). */
export const NombreContactoSchema = z.string().trim().min(1).max(60);

/** Teléfono colombiano: exactamente 10 dígitos (A2, R2). */
export const TelefonoSchema = z.string().regex(/^[0-9]{10}$/);

/** Parentesco opcional (A2, R3): vacío → `null`. */
export const ParentescoSchema = z
  .union([z.string().trim().max(40), z.null(), z.undefined()])
  .transform((valor) => {
    if (valor === undefined || valor === null || valor.length === 0) {
      return null;
    }
    return valor;
  });

/** Cuerpo de `PUT /api/contactos/<id>` (A2, §6). */
export const ContactoEscrituraSchema = z.object({
  nombre: NombreContactoSchema,
  telefono: TelefonoSchema,
  parentesco: ParentescoSchema,
});
export type ContactoEscritura = z.infer<typeof ContactoEscrituraSchema>;

/** Documento `contacto_confianza` tal como viaja y como vive en Firestore (A2, §7). */
export const ContactoSchema = z.object({
  id: IdSchema,
  nombre: NombreContactoSchema,
  telefono: TelefonoSchema,
  parentesco: z.string().nullable(),
  created_at: FechaIsoSchema,
  updated_at: FechaIsoSchema,
  deleted_at: FechaIsoSchema.nullable(),
});
export type Contacto = z.infer<typeof ContactoSchema>;

/** Estado de una alerta (A3, R1). */
export const EstadoAlertaSchema = z.enum(["cancelada", "mensaje_preparado"]);
export type EstadoAlerta = z.infer<typeof EstadoAlertaSchema>;

/** Ubicación opcional (A3, R2): o completa y en rango, o toda `null`. */
const LatitudSchema = z.number().min(-90).max(90);
const LongitudSchema = z.number().min(-180).max(180);
const PrecisionSchema = z.number().min(0).max(100_000);
const BateriaSchema = z.number().int().min(0).max(100);

/**
 * Cuerpo de `PUT /api/alertas/<id>` (A3, R1–R4).
 * La coherencia de la ubicación (todo o nada) y la hora no futura se comprueban
 * en el servicio, que tiene el reloj.
 */
export const AlertaEscrituraSchema = z.object({
  lat: LatitudSchema.nullable(),
  lng: LongitudSchema.nullable(),
  precision_m: PrecisionSchema.nullable(),
  bateria_pct: BateriaSchema.nullable(),
  estado: EstadoAlertaSchema,
  creada_en: FechaIsoSchema,
});
export type AlertaEscritura = z.infer<typeof AlertaEscrituraSchema>;

/** Documento `alerta` tal como viaja y como vive en Firestore (A3, §7). */
export const AlertaSchema = AlertaEscrituraSchema.extend({
  id: IdSchema,
  created_at: FechaIsoSchema,
  updated_at: FechaIsoSchema,
  deleted_at: FechaIsoSchema.nullable(),
});
export type Alerta = z.infer<typeof AlertaSchema>;

/** Respuesta de `GET /api/alertas` (A3, R7). */
export const RespuestaAlertasSchema = z.object({
  items: z.array(AlertaSchema),
  servidor_ahora: FechaIsoSchema,
});
export type RespuestaAlertas = z.infer<typeof RespuestaAlertasSchema>;

/** Un mes del resumen: `mes` en formato `YYYY-MM`, hora de Colombia (A3, R8). */
export const MesResumenSchema = z.object({
  mes: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/),
  total: z.number().int().positive(),
});
export type MesResumen = z.infer<typeof MesResumenSchema>;

/** Respuesta de `GET /api/alertas/resumen` (A3, R8). */
export const ResumenAlertasSchema = z.object({
  meses: z.array(MesResumenSchema),
  total: z.number().int().nonnegative(),
});
export type ResumenAlertas = z.infer<typeof ResumenAlertasSchema>;

/** Respuesta de `GET /api/contactos` (A2, R10). */
export const RespuestaContactosSchema = z.object({
  items: z.array(ContactoSchema),
  servidor_ahora: FechaIsoSchema,
});
export type RespuestaContactos = z.infer<typeof RespuestaContactosSchema>;

/** Petición con paginación por cursor de tiempo: `GET ?since=<ISO>`. */
export const BuscarPorFechaSchema = z.object({
  since: FechaIsoSchema.optional(),
});
export type BuscarPorFecha = z.infer<typeof BuscarPorFechaSchema>;

/** Tamaño máximo de una página de sincronización. */
export const MAXIMO_PAGINA = 500;

/** Respuesta de una página de sincronización. */
export function RespuestaPaginaSchema<Esquema extends z.ZodType>(item: Esquema) {
  return z.object({
    items: z.array(item),
    servidor_ahora: FechaIsoSchema,
  });
}

/** Versión que reporta la API (leída del `package.json`). No lleva datos personales. */
export const VERSION_API = "0.1.0";

/** Estado de `GET /api/health`. */
export const EstadoSaludSchema = z.enum(["listo", "sin_entorno"]);
export type EstadoSalud = z.infer<typeof EstadoSaludSchema>;

/** Cuerpo de `GET /api/health`. */
export const SaludSchema = z.object({
  ok: z.boolean(),
  estado: EstadoSaludSchema,
  version: z.string(),
});
export type Salud = z.infer<typeof SaludSchema>;

/** Sesión derivada del ID token verificado (nunca del cuerpo ni de la URL). */
export const SesionSchema = z.object({
  uid: z.string().min(1),
  email: z.string().optional(),
  rol: RolSchema,
});
export type Sesion = z.infer<typeof SesionSchema>;

/** Perfil elegido en el registro (spec A1, R3). */
export const PerfilCuentaSchema = z.enum(["persona", "contacto"]);
export type PerfilCuenta = z.infer<typeof PerfilCuentaSchema>;

/** Correo normalizado: recortado, en minúsculas, formato válido y ≤ 254 (spec A1, R1). */
export const CorreoSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Contraseña: 8–128 caracteres, sin recortar (spec A1, R2). */
export const ContrasenaSchema = z.string().min(8).max(128);

/** Cuerpo de `POST /api/auth/registro`. */
export const RegistroSchema = z.object({
  email: CorreoSchema,
  password: ContrasenaSchema,
  perfil: PerfilCuentaSchema,
});
export type Registro = z.infer<typeof RegistroSchema>;

/** Cuerpo de `POST /api/auth/login`. */
export const LoginSchema = z.object({
  email: CorreoSchema,
  password: ContrasenaSchema,
});
export type Login = z.infer<typeof LoginSchema>;

/** Cuerpo de `POST /api/auth/refresh`. */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).max(4096),
});
export type Refresh = z.infer<typeof RefreshSchema>;

/** Tokens que devuelve Firebase Auth por REST (nombres que ya usa la app). */
export const TokensSesionSchema = z.object({
  token: z.string().min(1),
  refreshToken: z.string().min(1),
  expiraEnSeg: z.number().int().positive(),
});
export type TokensSesion = z.infer<typeof TokensSesionSchema>;

/** Usuario público que devuelve la API (A1). */
export const UsuarioSchema = z.object({
  id: z.string().min(1),
  email: z.string(),
  rol: RolSchema,
});
export type Usuario = z.infer<typeof UsuarioSchema>;

/** Respuesta de registro y login: tokens + usuario. */
export const RespuestaCuentaSchema = TokensSesionSchema.extend({
  usuario: UsuarioSchema,
});
export type RespuestaCuenta = z.infer<typeof RespuestaCuentaSchema>;

/** Respuesta de `GET /api/auth/yo`. */
export const RespuestaYoSchema = z.object({
  usuario: UsuarioSchema,
});
export type RespuestaYo = z.infer<typeof RespuestaYoSchema>;

/** Cuerpo de `DELETE /api/mi-cuenta` (A4, R1): confirmación literal. */
export const BorrarCuentaSchema = z.object({
  confirmar: z.literal("BORRAR", { error: "Escribe BORRAR para confirmar" }),
});
export type BorrarCuenta = z.infer<typeof BorrarCuentaSchema>;

/** Respuesta de `GET /api/admin/estado` (A5, R3): solo totales agregados. */
export const EstadoAdminSchema = z.object({
  cuentas: z.number().int().nonnegative(),
  contactos: z.number().int().nonnegative(),
  alertas: z.number().int().nonnegative(),
});
export type EstadoAdmin = z.infer<typeof EstadoAdminSchema>;
