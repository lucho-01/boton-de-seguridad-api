import js from "@eslint/js";
import tseslint from "typescript-eslint";
import maxMethodsPerClass from "./scripts/eslint/max-methods-per-class.mjs";

const REGLAS_BASE = {
  curly: ["error", "all"],
  "no-empty": ["error", { allowEmptyCatch: true }],
  "@typescript-eslint/no-explicit-any": "error",
  "no-restricted-syntax": [
    "error",
    {
      selector: "ConditionalExpression",
      message:
        "Prohibido el operador ternario: usa if con retorno temprano o una tabla de búsqueda.",
    },
    {
      selector: "TSAnyKeyword",
      message:
        "Prohibido `any`, escrito o implícito: valida lo externo con Zod y tipa el resultado.",
    },
    {
      selector: "TSUnknownKeyword",
      message: "Prohibido `unknown`: valida lo externo con Zod en el mismo punto.",
    },
    {
      selector: "TSAsExpression > TSUnknownKeyword",
      message: "Prohibido `as unknown`: usa el esquema Zod que valida el dato.",
    },
  ],
  "max-lines-per-function": [
    "error",
    { max: 100, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  "local/max-methods-per-class": ["error", { max: 10 }],
};

const REGLAS_TIEMPO_INYECTADO = [
  ...REGLAS_BASE["no-restricted-syntax"],
  {
    selector: "NewExpression[callee.name='Date']",
    message: "El tiempo se inyecta (`now: Date`): no uses `new Date()` en la lógica de negocio.",
  },
];

export default tseslint.config(
  {
    ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts", "package-lock.json"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      local: { rules: { "max-methods-per-class": maxMethodsPerClass } },
    },
    rules: REGLAS_BASE,
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "max-lines-per-function": "off",
      "local/max-methods-per-class": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["app/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*", "@/features/**", "../features/*", "../../features/*"],
              message: "app/shared nunca importa features.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/api/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/server/*", "**/features/*/server/**"],
              message: "Las rutas llegan a la lógica solo por `@/features/container`.",
            },
            {
              group: ["firebase-admin", "firebase-admin/*"],
              message: "Las rutas no construyen clientes de Firebase: usa el contenedor.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["app/features/*/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/features/*/server/*", "@/features/container"],
              message:
                "Una feature no importa el server de otra: declara un puerto y conéctalo en el contenedor.",
            },
            {
              group: ["@/features/*/ui/*"],
              message: "El servidor no importa UI.",
            },
            {
              group: ["next/server", "next/headers"],
              message: "Los servicios no dependen de Next: reciben datos por parámetro.",
            },
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...REGLAS_TIEMPO_INYECTADO],
    },
  },
  {
    files: ["app/features/*/schema.ts", "app/shared/schema.ts"],
    rules: {
      "max-lines-per-function": "off",
    },
  },
);
