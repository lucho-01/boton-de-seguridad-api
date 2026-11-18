import { describe, expect, it } from "vitest";
import {
  Conflicto,
  DemasiadoGrande,
  DemasiadosIntentos,
  ErrorDeDominio,
  ErrorDeValidacion,
  ErrorInterno,
  NoAutenticado,
  NoAutorizado,
  NoEncontrado,
  NoSoportado,
} from "../server/errors";

/**
 * Spec A0 · §4 (tabla de traducción). Cada clase de dominio conserva su
 * mensaje legible y una única marca de error de dominio.
 */
describe("errores de dominio: mensaje y jerarquía", () => {
  it("NoEncontrado guarda el mensaje legible del recurso", () => {
    const error = new NoEncontrado("Contacto no existe");
    expect(error).toBeInstanceOf(ErrorDeDominio);
    expect(error.message).toBe("Contacto no existe");
  });

  it("todas las clases de dominio descienden de ErrorDeDominio", () => {
    const errores = [
      new ErrorDeValidacion([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]),
      new NoAutenticado("Falta la sesión"),
      new NoAutorizado("Sin permiso"),
      new NoEncontrado("No existe"),
      new Conflicto("Duplicado"),
      new DemasiadoGrande("Cuerpo demasiado grande"),
      new NoSoportado("Solo JSON"),
      new DemasiadosIntentos("Demasiados intentos"),
      new ErrorInterno("Inesperado"),
    ];
    for (const error of errores) {
      expect(error).toBeInstanceOf(ErrorDeDominio);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it("ErrorDeValidacion acepta detalles de campo", () => {
    const error = new ErrorDeValidacion([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]);
    expect(error.detalles).toEqual([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]);
  });

  it("ErrorDeValidacion con detalles se marca para exponerlos", () => {
    const error = new ErrorDeValidacion([{ campo: "telefono", mensaje: "Debe tener 10 dígitos" }]);
    expect(error.exponeDetalles).toBe(true);
  });

  it("ErrorDeValidacion vacío no expone detalles inventados", () => {
    const error = new ErrorDeValidacion([]);
    expect(error.exponeDetalles).toBe(false);
  });

  it("los errores que no son de validación nunca exponen detalles", () => {
    const errores = [
      new NoAutenticado("Falta la sesión"),
      new NoEncontrado("No existe"),
      new ErrorInterno("Inesperado"),
    ];
    for (const error of errores) {
      expect(error.exponeDetalles).toBe(false);
    }
  });
});
