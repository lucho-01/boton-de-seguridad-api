/**
 * Regla local: una clase no puede declarar más de N funciones
 * (métodos, constructor, getters/setters y propiedades que son funciones).
 *
 * Se escribe en JavaScript para no añadir dependencias al lint.
 *
 * @type {import("eslint").Rule.RuleModule}
 */
const regla = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Limita el número de funciones declaradas en una clase.",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      demasiadas:
        "Una clase no puede tener más de {{max}} funciones (tiene {{count}}). Divídela o extrae funciones.",
    },
  },
  create(context) {
    const max = context.options[0]?.max ?? 10;
    return {
      ClassBody(node) {
        let count = 0;
        for (const member of node.body) {
          if (member.type === "MethodDefinition") {
            count += 1;
            continue;
          }
          if (member.type === "PropertyDefinition" && member.value) {
            if (
              member.value.type === "ArrowFunctionExpression" ||
              member.value.type === "FunctionExpression"
            ) {
              count += 1;
            }
          }
        }
        if (count > max) {
          context.report({
            node,
            messageId: "demasiadas",
            data: { max, count },
          });
        }
      },
    };
  },
};

export default regla;
