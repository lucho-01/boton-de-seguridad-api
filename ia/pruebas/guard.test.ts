import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkToolCall, isForbiddenPath, isOutsideRoot } from "../../.opencode/guard/rules";

const RAIZ = process.cwd();

describe("guard: archivos y carpetas protegidas", () => {
  it("reconoce .env y todas sus variantes como prohibidos", () => {
    expect(isForbiddenPath(".env", RAIZ)).toBe(true);
    expect(isForbiddenPath(".env.local", RAIZ)).toBe(true);
    expect(isForbiddenPath("config/.env.production", RAIZ)).toBe(true);
  });

  it("permite leer el ejemplo sin valores", () => {
    expect(isForbiddenPath(".env.example", RAIZ)).toBe(false);
    expect(checkToolCall("read", { filePath: ".env.example" }, RAIZ)).toBeNull();
  });

  it("bloquea secrets/, data/ y claves de servicio", () => {
    expect(isForbiddenPath("secrets/service-account.json", RAIZ)).toBe(true);
    expect(isForbiddenPath("data/alertas.json", RAIZ)).toBe(true);
    expect(isForbiddenPath("firebase-adminsdk-abc123.json", RAIZ)).toBe(true);
    expect(isForbiddenPath("certs/servidor.pem", RAIZ)).toBe(true);
    expect(isForbiddenPath("clave.key", RAIZ)).toBe(true);
  });

  it("deja pasar archivos normales del proyecto", () => {
    expect(isForbiddenPath("app/api/health/route.ts", RAIZ)).toBe(false);
    expect(checkToolCall("read", { filePath: "app/shared/schema.ts" }, RAIZ)).toBeNull();
  });
});

describe("guard: no salir de la carpeta del proyecto", () => {
  it("detecta rutas relativas que suben de nivel", () => {
    expect(isOutsideRoot("..", RAIZ)).toBe(true);
    expect(isOutsideRoot("../otro-repo/archivo.txt", RAIZ)).toBe(true);
    expect(checkToolCall("read", { path: "../secreto.txt" }, RAIZ)).not.toBeNull();
  });

  it("detecta rutas absolutas fuera del proyecto", () => {
    const fuera = resolve(RAIZ, "..", "otro-repo", "secreto.txt");
    expect(isOutsideRoot(fuera, RAIZ)).toBe(true);
    expect(checkToolCall("read", { filePath: fuera }, RAIZ)).not.toBeNull();
  });

  it("detecta la carpeta home", () => {
    expect(isOutsideRoot("~/Documentos/clave.txt", RAIZ)).toBe(true);
  });

  it("no bloquea una ruta interna normal", () => {
    expect(isOutsideRoot("app/api/health/route.ts", RAIZ)).toBe(false);
  });
});

describe("guard: comandos de shell", () => {
  it("bloquea leer .env desde la terminal", () => {
    expect(checkToolCall("bash", { command: "cat .env" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "type .env.local" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "Get-Content .env" }, RAIZ)).not.toBeNull();
  });

  it("bloquea patrones glob que apuntan a secretos", () => {
    expect(checkToolCall("glob", { pattern: "**/.env*" }, RAIZ)).not.toBeNull();
    expect(
      checkToolCall("grep", { pattern: "FIREBASE", include: "secrets/**" }, RAIZ),
    ).not.toBeNull();
  });

  it("bloquea acciones con efecto externo", () => {
    expect(checkToolCall("bash", { command: "git push origin main" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "vercel deploy --prod" }, RAIZ)).not.toBeNull();
    expect(
      checkToolCall("bash", { command: "firebase deploy --only firestore" }, RAIZ),
    ).not.toBeNull();
    expect(checkToolCall("bash", { command: "curl https://ejemplo.com" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "rm -rf app" }, RAIZ)).not.toBeNull();
  });

  it("bloquea volcados de variables de entorno", () => {
    expect(checkToolCall("bash", { command: "printenv" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "env" }, RAIZ)).not.toBeNull();
    expect(checkToolCall("bash", { command: "Get-ChildItem env:" }, RAIZ)).not.toBeNull();
  });

  it("bloquea salir de la carpeta con cd", () => {
    expect(checkToolCall("bash", { command: "cd .." }, RAIZ)).not.toBeNull();
  });

  it("permite los comandos de verificación del proyecto", () => {
    expect(checkToolCall("bash", { command: "npm test" }, RAIZ)).toBeNull();
    expect(checkToolCall("bash", { command: "npm run check" }, RAIZ)).toBeNull();
    expect(checkToolCall("bash", { command: "npm run check:env" }, RAIZ)).toBeNull();
    expect(checkToolCall("bash", { command: "git status" }, RAIZ)).toBeNull();
  });
});
