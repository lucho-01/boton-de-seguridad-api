import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const RAIZ = process.cwd();

const PermisosSchema = z.record(z.string(), z.string());

const ConfigSchema = z.object({
  instructions: z.array(z.string()).min(1),
  permission: z.object({
    read: PermisosSchema,
    edit: PermisosSchema,
    bash: PermisosSchema,
    webfetch: z.string(),
  }),
});

const PackageSchema = z.object({
  scripts: z.record(z.string(), z.string()),
});

function leerConfig() {
  const texto = readFileSync(join(RAIZ, "opencode.json"), "utf8");
  return ConfigSchema.parse(JSON.parse(texto));
}

function leerPaquete() {
  const texto = readFileSync(join(RAIZ, "package.json"), "utf8");
  return PackageSchema.parse(JSON.parse(texto));
}

describe("opencode.json: permisos de lectura y edición", () => {
  it("carga AGENTS.md como instrucción", () => {
    expect(leerConfig().instructions).toContain("AGENTS.md");
  });

  it("niega leer secretos y permite el ejemplo", () => {
    const { read } = leerConfig().permission;
    expect(read[".env"]).toBe("deny");
    expect(read["**/.env"]).toBe("deny");
    expect(read[".env.example"]).toBe("allow");
    expect(read["secrets/**"]).toBe("deny");
    expect(read["data/**"]).toBe("deny");
    expect(read["*service-account*.json"]).toBe("deny");
    expect(read["*.pem"]).toBe("deny");
    expect(read["*.key"]).toBe("deny");
  });

  it("niega editar secretos y salir del proyecto", () => {
    const { edit } = leerConfig().permission;
    expect(edit[".env"]).toBe("deny");
    expect(edit["**/.env"]).toBe("deny");
    expect(edit["secrets/**"]).toBe("deny");
    expect(edit["../*"]).toBe("deny");
  });

  it("pide confirmación para configuración y acciones externas", () => {
    const { edit, bash, webfetch } = leerConfig().permission;
    expect(edit["opencode.json"]).toBe("ask");
    expect(edit["AGENTS.md"]).toBe("ask");
    expect(bash["*"]).toBe("ask");
    expect(bash["git push*"]).toBe("deny");
    expect(bash["vercel*"]).toBe("deny");
    expect(bash["*deploy*"] ?? bash["firebase *deploy*"]).toBe("deny");
    expect(bash["npm test*"]).toBe("allow");
    expect(webfetch).toBe("ask");
  });
});

describe("archivos de la configuración de IA", () => {
  const archivos = [
    "AGENTS.md",
    "opencode.json",
    ".opencode/guard/rules.ts",
    ".opencode/plugins/guard.ts",
    ".opencode/agents/lead.md",
    ".opencode/agents/backend.md",
    ".opencode/agents/tests.md",
    ".opencode/agents/security.md",
    ".opencode/skills/feature-workflow/SKILL.md",
    ".opencode/skills/write-spec/SKILL.md",
    ".opencode/skills/security-review/SKILL.md",
    ".opencode/skills/handoff-note/SKILL.md",
    "ia/bitacora-ia.md",
    "ia/README.md",
    "ia/pruebas/restricciones-en-vivo.md",
  ];

  for (const archivo of archivos) {
    it(`existe ${archivo}`, () => {
      expect(existsSync(join(RAIZ, archivo))).toBe(true);
    });
  }
});

describe("puertas de calidad", () => {
  it("define los comandos que exige el proyecto", () => {
    const { scripts } = leerPaquete();
    expect(scripts.lint).toBeDefined();
    expect(scripts.typecheck).toBeDefined();
    expect(scripts.test).toBeDefined();
    expect(scripts.check).toBeDefined();
  });

  it("check ejecuta formato, lint, tipos y pruebas", () => {
    const { check } = leerPaquete().scripts;
    expect(check).toContain("format:check");
    expect(check).toContain("lint");
    expect(check).toContain("typecheck");
    expect(check).toContain("test");
  });

  it("las pruebas de la configuración de IA se ejecutan con npm test", () => {
    const config = readFileSync(join(RAIZ, "vitest.config.mts"), "utf8");
    expect(config).toContain("ia/**/*.test.ts");
  });
});
