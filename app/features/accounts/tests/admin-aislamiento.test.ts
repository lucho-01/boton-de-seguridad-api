import { describe, expect, it } from "vitest";
import {
  AlertaEscrituraSchema,
  ContactoEscrituraSchema,
  type Sesion,
  SesionSchema,
} from "@/shared/schema";
import { type Reloj } from "@/shared/server/time";
import { crearServicioAlertas } from "@/features/alerts/server/alertas-service";
import { crearRepositorioAlertasEnMemoria } from "@/features/alerts/server/repository.memory";
import { crearServicioContactos } from "@/features/contacts/server/contactos-service";
import { crearRepositorioContactosEnMemoria } from "@/features/contacts/server/repository.memory";

/**
 * Regresión A5 §8.7 · el claim `admin` no cambia el aislamiento de A2/A3.
 *
 * Con servicios y repositorios REALES en memoria (cero Firestore), un token
 * `admin` sigue viendo solo sus propios contactos y alertas: el filtrado por
 * `uid` no depende del rol. No se duplican las pruebas de A2/A3; aquí solo se
 * comprueba que un `admin` no es una excepción al aislamiento.
 */

const AHORA = new Date("2026-11-14T08:00:00.000Z");
const RELOJ: Reloj = {
  ahora() {
    return new Date(AHORA);
  },
};

const UID_ADMIN = "uid-admin";
const UID_BETO = "uid-beto";
const ID_ANA = "11111111-1111-4111-8111-111111111111";
const ID_BETO = "22222222-2222-4222-8222-222222222222";

function sesionDe(uid: string, rol: Sesion["rol"]): Sesion {
  return SesionSchema.parse({ uid, email: `${uid}@x.com`, rol });
}

describe("A5 §8.7 · un admin solo ve sus propios contactos", () => {
  it("lista únicamente el contacto del uid de la sesión, no el de otra persona", async () => {
    const servicio = crearServicioContactos({
      repositorio: crearRepositorioContactosEnMemoria(),
      reloj: RELOJ,
    });
    await servicio.guardar(
      sesionDe(UID_ADMIN, "admin"),
      ID_ANA,
      ContactoEscrituraSchema.parse({ nombre: "Ana", telefono: "3001234567", parentesco: null }),
    );
    await servicio.guardar(
      sesionDe(UID_BETO, "usuario"),
      ID_BETO,
      ContactoEscrituraSchema.parse({ nombre: "Beto", telefono: "3007654321", parentesco: null }),
    );

    const lista = await servicio.listar(sesionDe(UID_ADMIN, "admin"));

    expect(lista.items.map((contacto) => contacto.id)).toEqual([ID_ANA]);
    expect(JSON.stringify(lista)).not.toContain(ID_BETO);
  });

  it("no puede borrar el contacto de otra persona: 404 aunque sea admin", async () => {
    const servicios = crearServicioContactos({
      repositorio: crearRepositorioContactosEnMemoria(),
      reloj: RELOJ,
    });
    await servicios.guardar(
      sesionDe(UID_BETO, "usuario"),
      ID_BETO,
      ContactoEscrituraSchema.parse({ nombre: "Beto", telefono: "3007654321", parentesco: null }),
    );

    await expect(servicios.borrar(sesionDe(UID_ADMIN, "admin"), ID_BETO)).rejects.toMatchObject({
      codigo: 404,
    });
    // El contacto de Beto sigue intacto.
    const listaBeto = await servicios.listar(sesionDe(UID_BETO, "usuario"));
    expect(listaBeto.items.map((contacto) => contacto.id)).toEqual([ID_BETO]);
  });
});

describe("A5 §8.7 · un admin solo ve sus propias alertas y su propio resumen", () => {
  function alerta() {
    return AlertaEscrituraSchema.parse({
      lat: null,
      lng: null,
      precision_m: null,
      bateria_pct: null,
      estado: "cancelada",
      creada_en: "2026-11-14T03:22:00.000Z",
    });
  }

  it("lista y resume únicamente las alertas del uid de la sesión", async () => {
    const servicio = crearServicioAlertas({
      repositorio: crearRepositorioAlertasEnMemoria(),
      reloj: RELOJ,
    });
    await servicio.guardar(sesionDe(UID_ADMIN, "admin"), ID_ANA, alerta());
    await servicio.guardar(sesionDe(UID_BETO, "usuario"), ID_BETO, alerta());

    const lista = await servicio.listar(sesionDe(UID_ADMIN, "admin"));
    const resumen = await servicio.resumen(sesionDe(UID_ADMIN, "admin"));

    expect(lista.items.map((alertaListada) => alertaListada.id)).toEqual([ID_ANA]);
    expect(JSON.stringify(lista)).not.toContain(ID_BETO);
    expect(resumen.total).toBe(1);
    expect(resumen.meses).toEqual([{ mes: "2026-11", total: 1 }]);
  });
});
