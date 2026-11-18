import { describe, expect, it, vi } from "vitest";
import {
  ErrorHttpSchema,
  LoginSchema,
  OkSchema,
  RegistroSchema,
  type RespuestaCuenta,
  RespuestaCuentaSchema,
  RefreshSchema,
  RespuestaYoSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { ErrorDeDominio, NoAutenticado } from "@/shared/server/errors";
import { respuestaDeError } from "@/shared/server/http";
import type { VerificadorDeToken } from "@/shared/server/session";
import type { Reloj } from "@/shared/server/time";
import {
  ErrorDeCuenta,
  type AuthRespuesta,
  type ClienteAuth,
  type CodigoFirebase,
  type Credenciales,
} from "@/shared/server/auth-client";
import { crearServicioCuentas, type DependenciasCuentas } from "../server/cuentas-service";
import { crearServicioIntentos } from "../server/intentos-service";
import { crearRepositorioIntentosEnMemoria } from "../server/intentos-repository.memory";
import type { PerfilDocumento, RepositorioPerfil } from "../server/repository";
import { crearRepositorioPerfilEnMemoria } from "../server/repository.memory";

/**
 * Spec A1 · Reglas de negocio de cuentas (sección 8, criterios del servicio).
 *
 * Dobles: `ClienteAuth` simulado, `RepositorioPerfil` en memoria, verificador de
 * token simulado y reloj fijo. Ninguna prueba toca la red ni Firebase.
 *
 * La validación de entrada (correo, contraseña, perfil, refreshToken) vive en
 * la frontera HTTP (Zod `RegistroSchema`/`LoginSchema`/`RefreshSchema`) y se
 * prueba en `app/api/tests/auth.test.ts`. Aquí se prueban las reglas: traducción
 * de errores de Firebase, rollback y armado de la respuesta.
 */

const AHORA = new Date("2026-11-14T08:00:00.000Z");

const RELOJ: Reloj = {
  ahora() {
    return new Date(AHORA);
  },
};

const CORREO = "ana@x.com";
const CONTRASENA = "contrasena-larga-123";
const UID = "uid-ana";

/** Sesión que devolverá el verificador simulado para los tokens del doble. */
function verificadorFijo(uid: string, email: string): VerificadorDeToken {
  return {
    async verificar(token: string) {
      expect(token.length).toBeGreaterThan(0);
      return SesionSchema.parse({ uid, email, rol: "usuario" });
    },
  };
}

/** Respuesta de Firebase Auth con todos los campos del puerto. */
function authRespuesta(campos?: Partial<AuthRespuesta>): AuthRespuesta {
  return {
    uid: UID,
    email: CORREO,
    idToken: "id-token-emitido",
    refreshToken: "refresh-emitido",
    expiraEnSeg: 3600,
    ...campos,
  };
}

/** Registro de llamadas del doble para poder verificar su uso. */
type RegistroDelDoble = {
  registros: Credenciales[];
  logins: Credenciales[];
  renovaciones: string[];
  roles: Array<{ uid: string; rol: string }>;
  eliminados: string[];
};

type Proveedor = {
  clienteAuth: ClienteAuth;
  registro: RegistroDelDoble;
};

/**
 * Doble de `ClienteAuth`. Cada método responde lo programado o lanza el código
 * de Firebase indicado; deja constancia de lo que recibió.
 */
function clienteFalso(opciones: {
  registro?: AuthRespuesta;
  login?: AuthRespuesta;
  renovado?: AuthRespuesta;
  fallaRegistrar?: CodigoFirebase;
  fallaLogin?: CodigoFirebase;
  fallaRenovar?: CodigoFirebase;
  fallaAsignarRol?: CodigoFirebase;
}): Proveedor {
  const registro: RegistroDelDoble = {
    registros: [],
    logins: [],
    renovaciones: [],
    roles: [],
    eliminados: [],
  };
  const fallar = (codigo: CodigoFirebase | undefined): void => {
    if (codigo !== undefined) {
      throw new ErrorDeCuenta(codigo);
    }
  };
  const clienteAuth: ClienteAuth = {
    async registrar(datos: Credenciales): Promise<AuthRespuesta> {
      registro.registros.push(datos);
      fallar(opciones.fallaRegistrar);
      return opciones.registro ?? authRespuesta();
    },
    async iniciarSesion(datos: Credenciales): Promise<AuthRespuesta> {
      registro.logins.push(datos);
      fallar(opciones.fallaLogin);
      return opciones.login ?? authRespuesta();
    },
    async renovar(datos: { refreshToken: string }): Promise<AuthRespuesta> {
      registro.renovaciones.push(datos.refreshToken);
      fallar(opciones.fallaRenovar);
      return opciones.renovado ?? authRespuesta();
    },
    async asignarRol(uid: string, rol: string): Promise<void> {
      fallar(opciones.fallaAsignarRol);
      registro.roles.push({ uid, rol });
    },
    async eliminarCuenta(uid: string): Promise<void> {
      registro.eliminados.push(uid);
    },
  };
  return { clienteAuth, registro };
}

/** Repositorio que siempre falla al crear el perfil (Firestore caído). */
function repositorioQueFallaAlCrear(): RepositorioPerfil {
  return {
    async crear(): Promise<never> {
      throw new Error("Firestore caído");
    },
    async obtener(): Promise<null> {
      return null;
    },
    async borrarTodo(): Promise<void> {
      throw new Error("Firestore caído");
    },
  };
}

/** Límite de intentos real con almacén en memoria: cada servicio tiene el suyo. */
function intentosDePrueba() {
  return crearServicioIntentos({
    repositorio: crearRepositorioIntentosEnMemoria(),
    reloj: RELOJ,
  });
}

function dependencias(proveedor: Proveedor, extras?: Partial<DependenciasCuentas>) {
  const base: DependenciasCuentas = {
    clienteAuth: proveedor.clienteAuth,
    repositorio: crearRepositorioPerfilEnMemoria(),
    verificador: verificadorFijo(UID, CORREO),
    reloj: RELOJ,
    intentos: intentosDePrueba(),
    ...extras,
  };
  return base;
}

const REGISTRO = RegistroSchema.parse({ email: CORREO, password: CONTRASENA, perfil: "persona" });
const LOGIN = LoginSchema.parse({ email: CORREO, password: CONTRASENA });
const REFRESH = RefreshSchema.parse({ refreshToken: "refresh-viejo" });

/** Ejecuta una operación que debe fallar y devuelve el `ErrorDeDominio`. */
async function esperarError(promesa: Promise<object>): Promise<ErrorDeDominio> {
  try {
    await promesa;
  } catch (capturado) {
    if (capturado instanceof ErrorDeDominio) {
      return capturado;
    }
    if (capturado instanceof Error) {
      throw new Error(`Esperaba ErrorDeDominio y llegó ${capturado.name}: ${capturado.message}`);
    }
    throw new Error("Esperaba un ErrorDeDominio");
  }
  throw new Error("La prueba esperaba un rechazo y resolvió");
}

async function cuerpoDeError(error: ErrorDeDominio) {
  return ErrorHttpSchema.parse(await respuestaDeError(error).json());
}

describe("A1 §8.1 · registro válido: tokens y usuario con rol 'usuario'", () => {
  it("valida con RespuestaCuentaSchema, expiraEnSeg > 0 y usuario.rol 'usuario'", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const resultado = await servicio.registrar(REGISTRO);
    const validado = RespuestaCuentaSchema.parse(resultado);
    expect(validado.expiraEnSeg).toBeGreaterThan(0);
    expect(validado.usuario.rol).toBe("usuario");
    expect(validado.usuario.id).toBe(UID);
    expect(validado.token).toBe("id-token-emitido");
    expect(validado.refreshToken).toBe("refresh-emitido");
  });

  it("usuario trae solo { id, email, rol }: nunca 'perfil'", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const resultado = await servicio.registrar(REGISTRO);
    expect(Object.keys(resultado.usuario).sort()).toEqual(["email", "id", "rol"]);
  });

  it("el id del usuario es el uid verificado del token recién emitido", async () => {
    const proveedor = clienteFalso({
      registro: authRespuesta({ uid: "otro-uid", idToken: "tok" }),
    });
    const servicio = crearServicioCuentas(
      dependencias(proveedor, { verificador: verificadorFijo("otro-uid", CORREO) }),
    );
    const resultado = await servicio.registrar(REGISTRO);
    expect(resultado.usuario.id).toBe("otro-uid");
  });
});

describe("A1 §8.2 · el correo normalizado es el que llega y el que se guarda", () => {
  it("el servicio reenvía a Firebase el correo ya normalizado por el esquema", async () => {
    const proveedor = clienteFalso({});
    const repositorio = crearRepositorioPerfilEnMemoria();
    const servicio = crearServicioCuentas(dependencias(proveedor, { repositorio }));
    // El esquema recorta y baja a minúsculas ANTES de llamar al servicio.
    const registro = RegistroSchema.parse({
      email: "  Ana@X.com ",
      password: CONTRASENA,
      perfil: "persona",
    });
    await servicio.registrar(registro);
    expect(proveedor.registro.registros[0]?.email).toBe("ana@x.com");
    expect((await repositorio.obtener(UID))?.email).toBe("ana@x.com");
  });
});

describe("A1 §8.3 · correo existente → 409 'El correo ya está registrado' (R5)", () => {
  it("EMAIL_EXISTS al registrar → 409 con el mensaje literal", async () => {
    const proveedor = clienteFalso({ fallaRegistrar: "EMAIL_EXISTS" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(409);
    expect((await cuerpoDeError(error)).error).toBe("El correo ya está registrado");
  });

  it("no revela el correo en el mensaje del 409", async () => {
    const proveedor = clienteFalso({ fallaRegistrar: "EMAIL_EXISTS" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(JSON.stringify(await cuerpoDeError(error))).not.toContain(CORREO);
  });

  it("si el correo ya existe no se crea ningún perfil", async () => {
    const proveedor = clienteFalso({ fallaRegistrar: "EMAIL_EXISTS" });
    const repositorio = crearRepositorioPerfilEnMemoria();
    const servicio = crearServicioCuentas(dependencias(proveedor, { repositorio }));
    await esperarError(servicio.registrar(REGISTRO));
    expect(await repositorio.obtener(UID)).toBeNull();
  });
});

describe("A1 §8.6 · credenciales inválidas en login → mismo 401 (R6)", () => {
  const codigos: CodigoFirebase[] = [
    "INVALID_PASSWORD",
    "EMAIL_NOT_FOUND",
    "INVALID_LOGIN_CREDENTIALS",
    "INVALID_EMAIL",
  ];

  for (const codigo of codigos) {
    it(`${codigo} → 401 'Correo o contraseña incorrectos'`, async () => {
      const proveedor = clienteFalso({ fallaLogin: codigo });
      const servicio = crearServicioCuentas(dependencias(proveedor));
      const error = await esperarError(servicio.iniciarSesion(LOGIN));
      expect(error.codigo).toBe(401);
      expect((await cuerpoDeError(error)).error).toBe("Correo o contraseña incorrectos");
    });
  }

  it("existir o no el correo produce el MISMO cuerpo (no se revela la cuenta)", async () => {
    const conPasswordMala = clienteFalso({ fallaLogin: "INVALID_PASSWORD" });
    const sinCorreo = clienteFalso({ fallaLogin: "EMAIL_NOT_FOUND" });
    const errorA = await esperarError(
      crearServicioCuentas(dependencias(conPasswordMala)).iniciarSesion(LOGIN),
    );
    const errorB = await esperarError(
      crearServicioCuentas(dependencias(sinCorreo)).iniciarSesion(LOGIN),
    );
    expect(JSON.stringify(await cuerpoDeError(errorA))).toBe(
      JSON.stringify(await cuerpoDeError(errorB)),
    );
  });
});

describe("A1 §8.7 · login correcto → tokens y usuario del perfil", () => {
  it("devuelve token/refreshToken de Firebase y el usuario desde el token", async () => {
    const proveedor = clienteFalso({
      login: authRespuesta({ idToken: "id-login", refreshToken: "refresh-login" }),
    });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const resultado = await servicio.iniciarSesion(LOGIN);
    expect(resultado.token).toBe("id-login");
    expect(resultado.refreshToken).toBe("refresh-login");
    expect(resultado.usuario).toEqual({ id: UID, email: CORREO, rol: "usuario" });
    expect(resultado.usuario).not.toHaveProperty("perfil");
  });

  it("la contraseña nunca aparece en la respuesta de login", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const resultado = await servicio.iniciarSesion(LOGIN);
    expect(JSON.stringify(resultado)).not.toContain(CONTRASENA);
  });
});

describe("A1 §8.8 · cuenta deshabilitada → 403 (R7)", () => {
  it("USER_DISABLED → 403 'La cuenta está deshabilitada'", async () => {
    const proveedor = clienteFalso({ fallaLogin: "USER_DISABLED" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.iniciarSesion(LOGIN));
    expect(error.codigo).toBe(403);
    expect((await cuerpoDeError(error)).error).toBe("La cuenta está deshabilitada");
  });
});

describe("A1 §8.9 · demasiados intentos → 429 (R8)", () => {
  it("TOO_MANY_ATTEMPTS_TRY_LATER → 429 'Demasiados intentos; espera unos minutos'", async () => {
    const proveedor = clienteFalso({ fallaLogin: "TOO_MANY_ATTEMPTS_TRY_LATER" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.iniciarSesion(LOGIN));
    expect(error.codigo).toBe(429);
    expect((await cuerpoDeError(error)).error).toBe("Demasiados intentos; espera unos minutos");
  });
});

describe("A1 §8.10 · refresh válido → 200 con tokens nuevos (R9)", () => {
  it("devuelve un idToken y un refreshToken distintos y expiraEnSeg", async () => {
    const proveedor = clienteFalso({
      renovado: authRespuesta({
        idToken: "id-token-nuevo",
        refreshToken: "refresh-nuevo",
        expiraEnSeg: 3600,
      }),
    });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const resultado = await servicio.renovar(REFRESH);
    expect(resultado.token).toBe("id-token-nuevo");
    expect(resultado.refreshToken).toBe("refresh-nuevo");
    expect(resultado.token).not.toBe(REFRESH.refreshToken);
    expect(resultado.refreshToken).not.toBe(REFRESH.refreshToken);
    expect(resultado.expiraEnSeg).toBeGreaterThan(0);
  });

  it("el servicio reenvía el refreshToken recibido al cliente", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    await servicio.renovar(REFRESH);
    expect(proveedor.registro.renovaciones).toEqual([REFRESH.refreshToken]);
  });
});

describe("A1 §8.11 · refresh inválido o vencido → 401", () => {
  const codigos: CodigoFirebase[] = ["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND"];

  for (const codigo of codigos) {
    it(`${codigo} → 401`, async () => {
      const proveedor = clienteFalso({ fallaRenovar: codigo });
      const servicio = crearServicioCuentas(dependencias(proveedor));
      const error = await esperarError(servicio.renovar(REFRESH));
      expect(error.codigo).toBe(401);
    });
  }
});

describe("A1 §8.14 · rollback de la cuenta si un paso posterior falla (R4)", () => {
  it("si crear el perfil falla → elimina la cuenta y responde 500 'Error interno' sin detalles", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(
      dependencias(proveedor, { repositorio: repositorioQueFallaAlCrear() }),
    );
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(500);
    expect(proveedor.registro.eliminados).toEqual([UID]);
    const cuerpo = await cuerpoDeError(error);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("si asignar el rol falla → también elimina la cuenta y responde 500", async () => {
    const proveedor = clienteFalso({ fallaAsignarRol: "DESCONOCIDO" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(500);
    expect(proveedor.registro.eliminados).toEqual([UID]);
  });

  it("si el perfil falla, no se deja perfil creado a medias", async () => {
    const proveedor = clienteFalso({});
    const repositorio = crearRepositorioPerfilEnMemoria();
    // El repositorio falla siempre: el perfil no queda.
    const servicio = crearServicioCuentas(
      dependencias(proveedor, { repositorio: repositorioQueFallaAlCrear() }),
    );
    await esperarError(servicio.registrar(REGISTRO));
    expect(await repositorio.obtener(UID)).toBeNull();
  });

  it("un registro correcto no borra la cuenta e iguala el claim rol a 'usuario'", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    await servicio.registrar(REGISTRO);
    expect(proveedor.registro.eliminados).toHaveLength(0);
    expect(proveedor.registro.roles).toEqual([{ uid: UID, rol: "usuario" }]);
  });

  it("el perfil guardado usa el rol 'usuario', el correo y el reloj inyectado", async () => {
    const proveedor = clienteFalso({});
    const repositorio = crearRepositorioPerfilEnMemoria();
    const servicio = crearServicioCuentas(dependencias(proveedor, { repositorio }));
    await servicio.registrar(REGISTRO);
    const perfil = await repositorio.obtener(UID);
    expect(perfil?.rol).toBe("usuario");
    expect(perfil?.email).toBe(CORREO);
    expect(perfil?.created_at).toBe(AHORA.toISOString());
    expect(perfil?.deleted_at).toBeNull();
  });
});

describe("A1 §8.14 (extendido) · si la verificación del token falla tras crear la cuenta → rollback", () => {
  /** Verificador que siempre falla; la causa no importa, el servicio la hace 500. */
  function verificadorQueFalla(fallo: Error): VerificadorDeToken {
    return {
      async verificar() {
        throw fallo;
      },
    };
  }

  it("NoAutenticado del verificador → 500 y eliminarCuenta llamado una sola vez con el uid", async () => {
    const proveedor = clienteFalso({});
    const verificador = verificadorQueFalla(new NoAutenticado("Sesión inválida o vencida"));
    const servicio = crearServicioCuentas(dependencias(proveedor, { verificador }));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(500);
    expect(proveedor.registro.eliminados).toEqual([UID]);
    const cuerpo = await cuerpoDeError(error);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("un Error genérico del verificador también dispara el rollback", async () => {
    const proveedor = clienteFalso({});
    const verificador = verificadorQueFalla(new Error("firma inválida"));
    const servicio = crearServicioCuentas(dependencias(proveedor, { verificador }));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(500);
    expect(proveedor.registro.eliminados).toEqual([UID]);
  });

  it("el rollback ocurre DESPUÉS de crear el perfil: el perfil existe, la cuenta de Auth se borra", async () => {
    // Comportamiento documentado: el rollback solo borra la cuenta de Firebase
    // Auth; el perfil en Firestore ya creado permanece (no hay borrado de perfil
    // en A1). Si el verificador falla, la cuenta no queda huérfana en Auth.
    const proveedor = clienteFalso({});
    const repositorio = crearRepositorioPerfilEnMemoria();
    const verificador = verificadorQueFalla(new NoAutenticado("Sesión inválida o vencida"));
    const servicio = crearServicioCuentas(dependencias(proveedor, { repositorio, verificador }));
    await esperarError(servicio.registrar(REGISTRO));
    expect(proveedor.registro.eliminados).toEqual([UID]);
    const perfil = await repositorio.obtener(UID);
    // El perfil queda creado (la verificación ocurre después de crearlo).
    expect(perfil).not.toBeNull();
    expect(perfil?.email).toBe(CORREO);
  });

  it("nunca responde con tokens si el verificador falla (no devuelve una sesión a medias)", async () => {
    const proveedor = clienteFalso({});
    const verificador = verificadorQueFalla(new NoAutenticado("Sesión inválida o vencida"));
    const servicio = crearServicioCuentas(dependencias(proveedor, { verificador }));
    await expect(servicio.registrar(REGISTRO)).rejects.toBeInstanceOf(ErrorDeDominio);
  });
});

describe("A1 §8.14 (extendido) · un fallo del verificador en login NO hace rollback", () => {
  it("login con verificador que lanza un Error genérico rechaza sin borrar ninguna cuenta", async () => {
    // En login `respuestaDeCuenta` NO está dentro del try de rollback: un fallo
    // del verificador se propaga (la ruta lo convierte en 500 con `manejar`).
    // Lo que importa: nunca se invoca `eliminarCuenta` ni `registrar`.
    const proveedor = clienteFalso({});
    const verificador: VerificadorDeToken = {
      async verificar() {
        throw new Error("fallo inesperado del verificador");
      },
    };
    const servicio = crearServicioCuentas(dependencias(proveedor, { verificador }));
    await expect(servicio.iniciarSesion(LOGIN)).rejects.toBeInstanceOf(Error);
    expect(proveedor.registro.eliminados).toHaveLength(0);
    expect(proveedor.registro.registros).toHaveLength(0);
  });

  it("login no hace rollback aunque el verificador lance NoAutenticado (propaga su 401, sin borrar)", async () => {
    // La verificación en login NO está envuelta en el try del rollback: el
    // NoAutenticado del verificador se propaga tal cual (401). Lo que importa:
    // nunca se invoca `eliminarCuenta`.
    const proveedor = clienteFalso({});
    const verificador: VerificadorDeToken = {
      async verificar() {
        throw new NoAutenticado("Sesión inválida o vencida");
      },
    };
    const servicio = crearServicioCuentas(dependencias(proveedor, { verificador }));
    const error = await esperarError(servicio.iniciarSesion(LOGIN));
    expect(error.codigo).toBe(401);
    expect(proveedor.registro.eliminados).toHaveLength(0);
    expect(proveedor.registro.registros).toHaveLength(0);
  });
});

describe("A1 §8.15 · ninguna respuesta filtra contraseña ni tokens", () => {
  it("los errores de login no contienen la contraseña", async () => {
    const proveedor = clienteFalso({ fallaLogin: "INVALID_PASSWORD" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.iniciarSesion(LOGIN));
    expect(JSON.stringify(await cuerpoDeError(error))).not.toContain(CONTRASENA);
  });

  it("el error de refresh no contiene el refreshToken recibido", async () => {
    const proveedor = clienteFalso({ fallaRenovar: "INVALID_REFRESH_TOKEN" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.renovar(REFRESH));
    expect(JSON.stringify(await cuerpoDeError(error))).not.toContain(REFRESH.refreshToken);
  });
});

describe("A1 §8.16 (extra) · WEAK_PASSWORD → 400 mensaje de contraseña débil", () => {
  it("traduce WEAK_PASSWORD a 400 'La contraseña es demasiado débil'", async () => {
    const proveedor = clienteFalso({ fallaRegistrar: "WEAK_PASSWORD" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const error = await esperarError(servicio.registrar(REGISTRO));
    expect(error.codigo).toBe(400);
    expect((await cuerpoDeError(error)).error).toBe("La contraseña es demasiado débil");
  });

  it("si el registro nunca creó la cuenta no se intenta borrar", async () => {
    const proveedor = clienteFalso({ fallaRegistrar: "WEAK_PASSWORD" });
    const servicio = crearServicioCuentas(dependencias(proveedor));
    await esperarError(servicio.registrar(REGISTRO));
    expect(proveedor.registro.eliminados).toHaveLength(0);
  });
});

describe("A1 §8 (extra) · errores de Firebase de configuración/red → 500 opaco", () => {
  const codigos: CodigoFirebase[] = ["CONFIGURATION_NOT_FOUND", "DESCONOCIDO", "RED"];

  for (const codigo of codigos) {
    it(`${codigo} → 500 'Error interno' sin detalles`, async () => {
      const proveedor = clienteFalso({ fallaLogin: codigo });
      const servicio = crearServicioCuentas(dependencias(proveedor));
      const error = await esperarError(servicio.iniciarSesion(LOGIN));
      expect(error.codigo).toBe(500);
      const cuerpo = await cuerpoDeError(error);
      expect(cuerpo.error).toBe("Error interno");
      expect(cuerpo.detalles).toBeUndefined();
    });
  }
});

describe("A1 §8.12 (servicio) · yo: el id sale del uid de la sesión (R10)", () => {
  it("devuelve { usuario: { id: uid, email, rol } } del token verificado", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const sesion = SesionSchema.parse({ uid: "u1", email: "u1@x.com", rol: "usuario" });
    const resultado = await servicio.yo(sesion);
    const validado = RespuestaYoSchema.parse(resultado);
    expect(validado.usuario).toEqual({ id: "u1", email: "u1@x.com", rol: "usuario" });
  });

  it("si el token no trae correo, usa el del perfil; si tampoco, cadena vacía", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const sinCorreo = SesionSchema.parse({ uid: "u1", rol: "usuario" });
    const resultado = await servicio.yo(sinCorreo);
    // No hay perfil en el repositorio de prueba → correo vacío.
    expect(resultado.usuario.email).toBe("");
    expect(resultado.usuario.id).toBe("u1");
  });
});

describe("A1 §8 · el servicio nunca devuelve 'perfil' en ninguna respuesta", () => {
  it("ni registro ni login ni yo exponen el campo perfil", async () => {
    const proveedor = clienteFalso({});
    const servicio = crearServicioCuentas(dependencias(proveedor));
    const registro: RespuestaCuenta = await servicio.registrar(REGISTRO);
    const login: RespuestaCuenta = await servicio.iniciarSesion(LOGIN);
    const yo = await servicio.yo(SesionSchema.parse({ uid: UID, email: CORREO, rol: "usuario" }));
    for (const respuesta of [registro, login, yo]) {
      expect(respuesta.usuario).not.toHaveProperty("perfil");
    }
  });
});

// ---------------------------------------------------------------------------
// A4 · borrar mi cuenta y todos mis datos (spec A4, §4, §8, §9)
//
// Dobles propios de A4: un repositorio que registra el `uid` que recibe
// `borrarTodo` y un `ClienteAuth` que registra `eliminarCuenta`. Ninguna prueba
// toca red ni Firebase; el orden se comprueba con una bitácora compartida.
// ---------------------------------------------------------------------------

type FalloAuth = CodigoFirebase | "GENERICO";

/** Estado observable de los dobles: orden de pasos y objetivos borrados. */
type BitacoraBorrado = {
  orden: string[];
  borrados: string[];
  eliminados: string[];
};

/** Configuración mutable del doble de Auth (permite cambiar el fallo entre llamadas). */
type ConfigAuth = {
  falla: FalloAuth | null;
};

type RepositorioDePrueba = {
  repositorio: RepositorioPerfil;
  perfiles: Map<string, string>;
};

function nuevaBitacora(): BitacoraBorrado {
  return { orden: [], borrados: [], eliminados: [] };
}

/** Perfil mínimo con la forma del documento persistido. */
function perfilDe(uid: string, email: string): PerfilDocumento {
  const instante = AHORA.toISOString();
  return {
    email,
    rol: "usuario",
    perfil: "persona",
    created_at: instante,
    updated_at: instante,
    deleted_at: null,
  };
}

/**
 * Repositorio de perfiles con `borrarTodo`. Guarda un mapa `uid → email` para
 * comprobar el aislamiento entre cuentas y registra cada borrado pedido.
 */
function repositorioDeBorrado(
  bitacora: BitacoraBorrado,
  opciones: { falla?: boolean; perfiles?: Array<{ uid: string; email: string }> } = {},
): RepositorioDePrueba {
  const perfiles = new Map<string, string>();
  const iniciales = opciones.perfiles ?? [];
  for (const perfil of iniciales) {
    perfiles.set(perfil.uid, perfil.email);
  }
  const repositorio: RepositorioPerfil = {
    async crear(): Promise<PerfilDocumento> {
      throw new Error("no usado en A4");
    },
    async obtener(uid: string): Promise<PerfilDocumento | null> {
      const email = perfiles.get(uid);
      if (email === undefined) {
        return null;
      }
      return perfilDe(uid, email);
    },
    async borrarTodo(uid: string): Promise<void> {
      bitacora.orden.push("firestore");
      bitacora.borrados.push(uid);
      if (opciones.falla === true) {
        throw new Error("Firestore caído");
      }
      perfiles.delete(uid);
    },
  };
  return { repositorio, perfiles };
}

/**
 * Doble de `ClienteAuth` para A4: `eliminarCuenta` registra el `uid` y, si se
 * programó un fallo, lanza el código de Firebase o un error genérico. Los demás
 * métodos no se usan y fallan si alguien los toca por error.
 */
function clienteDeBorrado(
  bitacora: BitacoraBorrado,
  config: ConfigAuth = { falla: null },
): ClienteAuth {
  const sinUso = (): Promise<never> => Promise.reject(new Error("no usado en A4"));
  return {
    registrar: sinUso,
    iniciarSesion: sinUso,
    renovar: sinUso,
    async asignarRol(): Promise<void> {
      throw new Error("no usado en A4");
    },
    async eliminarCuenta(uid: string): Promise<void> {
      bitacora.orden.push("auth");
      bitacora.eliminados.push(uid);
      if (config.falla === null) {
        return;
      }
      if (config.falla === "GENERICO") {
        throw new Error("Auth caído");
      }
      throw new ErrorDeCuenta(config.falla);
    },
  };
}

function sesionDe(uid: string, email = CORREO): Sesion {
  return SesionSchema.parse({ uid, email, rol: "usuario" });
}

function dependenciasA4(
  repositorio: RepositorioPerfil,
  clienteAuth: ClienteAuth,
): DependenciasCuentas {
  return {
    clienteAuth,
    repositorio,
    verificador: verificadorFijo(UID, CORREO),
    reloj: RELOJ,
    intentos: intentosDePrueba(),
  };
}

describe("A4 §8.1 · borra los datos y la cuenta con el uid de la sesión", () => {
  it("borrarTodo y eliminarCuenta reciben exactamente el uid de la sesión → { ok: true }", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    const resultado = await servicio.borrarCuenta(sesionDe(UID));

    expect(OkSchema.parse(resultado)).toEqual({ ok: true });
    expect(bitacora.borrados).toEqual([UID]);
    expect(bitacora.eliminados).toEqual([UID]);
    expect(doble.perfiles.has(UID)).toBe(false);
  });

  it("borra primero Firestore y después Auth (R5)", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    await servicio.borrarCuenta(sesionDe(UID));

    expect(bitacora.orden).toEqual(["firestore", "auth"]);
  });

  it("la respuesta nunca incluye correo, uid ni tokens (R7)", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    const resultado = await servicio.borrarCuenta(sesionDe(UID));

    expect(JSON.stringify(resultado)).not.toContain(CORREO);
    expect(JSON.stringify(resultado)).not.toContain(UID);
  });

  it("solo borra el uid de la sesión: el perfil de otra cuenta queda intacto (R2)", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      perfiles: [
        { uid: UID, email: CORREO },
        { uid: "uid-beto", email: "beto@x.com" },
      ],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    await servicio.borrarCuenta(sesionDe(UID));

    expect(bitacora.borrados).toEqual([UID]);
    expect(doble.perfiles.has(UID)).toBe(false);
    expect(doble.perfiles.has("uid-beto")).toBe(true);
  });

  it("una sesión con uid A no borra B aunque el correo de la sesión sea de B", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      perfiles: [
        { uid: "uid-a", email: "a@x.com" },
        { uid: "uid-b", email: "b@x.com" },
      ],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    await servicio.borrarCuenta(sesionDe("uid-a", "b@x.com"));

    expect(bitacora.borrados).toEqual(["uid-a"]);
    expect(bitacora.eliminados).toEqual(["uid-a"]);
    expect(doble.perfiles.has("uid-b")).toBe(true);
  });
});

describe("A4 §8.5 · fallo de Firestore → 500 y Auth intacto", () => {
  it("responde 500 'Error interno' y NO llama a eliminarCuenta", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      falla: true,
      perfiles: [{ uid: UID, email: CORREO }],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    const error = await esperarError(servicio.borrarCuenta(sesionDe(UID)));

    expect(error.codigo).toBe(500);
    expect(bitacora.eliminados).toEqual([]);
    expect(bitacora.orden).toEqual(["firestore"]);
    const cuerpo = await cuerpoDeError(error);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("los datos siguen ahí después del fallo: el reintento puede completar el borrado", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      falla: true,
      perfiles: [{ uid: UID, email: CORREO }],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    await esperarError(servicio.borrarCuenta(sesionDe(UID)));

    expect(doble.perfiles.has(UID)).toBe(true);
  });
});

describe("A4 §8.6 · fallo de Auth tras borrar los datos → 500", () => {
  it("un error genérico de Auth responde 500 'Error interno' sin detalles", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora, { falla: "GENERICO" })),
    );
    const error = await esperarError(servicio.borrarCuenta(sesionDe(UID)));

    expect(error.codigo).toBe(500);
    expect(bitacora.orden).toEqual(["firestore", "auth"]);
    expect(doble.perfiles.has(UID)).toBe(false);
    const cuerpo = await cuerpoDeError(error);
    expect(cuerpo.error).toBe("Error interno");
    expect(cuerpo.detalles).toBeUndefined();
  });

  it("un código de Firebase distinto de USER_NOT_FOUND también es 500", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora, { falla: "RED" })),
    );
    const error = await esperarError(servicio.borrarCuenta(sesionDe(UID)));

    expect(error.codigo).toBe(500);
    expect((await cuerpoDeError(error)).error).toBe("Error interno");
  });
});

describe("A4 §8.7 y §8.8 · USER_NOT_FOUND e idempotencia", () => {
  it("si Auth ya no tiene la cuenta (USER_NOT_FOUND) → éxito { ok: true }", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora, { falla: "USER_NOT_FOUND" })),
    );
    const resultado = await servicio.borrarCuenta(sesionDe(UID));

    expect(OkSchema.parse(resultado)).toEqual({ ok: true });
    expect(bitacora.borrados).toEqual([UID]);
    expect(doble.perfiles.has(UID)).toBe(false);
  });

  it("segundo intento con repositorio vacío y Auth USER_NOT_FOUND → éxito", async () => {
    const bitacora = nuevaBitacora();
    const configAuth: ConfigAuth = { falla: null };
    const doble = repositorioDeBorrado(bitacora, { perfiles: [{ uid: UID, email: CORREO }] });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora, configAuth)),
    );

    const primero = await servicio.borrarCuenta(sesionDe(UID));
    configAuth.falla = "USER_NOT_FOUND";
    const segundo = await servicio.borrarCuenta(sesionDe(UID));

    expect(OkSchema.parse(primero)).toEqual({ ok: true });
    expect(OkSchema.parse(segundo)).toEqual({ ok: true });
    expect(bitacora.borrados).toEqual([UID, UID]);
    expect(doble.perfiles.has(UID)).toBe(false);
  });
});

describe("A4 §8.9 · ni logs ni respuestas filtran datos personales", () => {
  it("un fallo de Firestore no registra correo ni uid en console.error", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      falla: true,
      perfiles: [{ uid: UID, email: CORREO }],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora)),
    );
    const espia = vi.spyOn(console, "error").mockImplementation((): void => {});
    try {
      const error = await esperarError(servicio.borrarCuenta(sesionDe(UID)));
      const registrado = JSON.stringify(espia.mock.calls);
      const respuesta = JSON.stringify(await cuerpoDeError(error));
      expect(registrado).not.toContain(CORREO);
      expect(registrado).not.toContain(UID);
      expect(respuesta).not.toContain(CORREO);
      expect(respuesta).not.toContain(UID);
    } finally {
      espia.mockRestore();
    }
  });

  it("un fallo de Auth (no USER_NOT_FOUND) no registra correo ni uid", async () => {
    const bitacora = nuevaBitacora();
    const doble = repositorioDeBorrado(bitacora, {
      perfiles: [{ uid: UID, email: CORREO }],
    });
    const servicio = crearServicioCuentas(
      dependenciasA4(doble.repositorio, clienteDeBorrado(bitacora, { falla: "GENERICO" })),
    );
    const espia = vi.spyOn(console, "error").mockImplementation((): void => {});
    try {
      const error = await esperarError(servicio.borrarCuenta(sesionDe(UID)));
      const registrado = JSON.stringify(espia.mock.calls);
      const respuesta = JSON.stringify(await cuerpoDeError(error));
      expect(espia).toHaveBeenCalled();
      expect(registrado).not.toContain(CORREO);
      expect(registrado).not.toContain(UID);
      expect(registrado).not.toContain("Auth caído");
      expect(respuesta).not.toContain(CORREO);
      expect(respuesta).not.toContain(UID);
    } finally {
      espia.mockRestore();
    }
  });
});
