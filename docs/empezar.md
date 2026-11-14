# Empezar

## 1. Lo que haces tú (los agentes no pueden)

1. **Node 24.x** y npm (`node -v`), y git.
2. **Un harness con OpenCode:** `npm i -g opencode-ai`, luego `opencode` en esta carpeta y `/connect` con el modelo que uses. No envíes datos personales ni secretos a modelos gratuitos.
3. **Tu propio proyecto de Firebase** (plan Spark, sin tarjeta; nunca el de otra persona):
   - *Authentication → Get started → Correo/contraseña* activado.
   - *Firestore Database* creada en modo producción; en *Reglas* pega el contenido de `firestore.rules`.
   - En *Authentication → Configuración → Acciones de usuario* desactiva el registro desde el cliente.
   - En *Configuración → Cuentas de servicio* genera una clave privada y copia sus campos a `FIREBASE_*`. No la pegues en ningún documento ni chat.
   - En *Configuración del proyecto → Tus apps → Web* copia la clave a `FIREBASE_WEB_API_KEY`.
4. **Archivo de entorno:** copia `.env.example` a `.env` y llénalo. Los agentes no lo leen ni lo crean (el guard lo bloquea).
5. **GitHub y Vercel:** repositorio propio, proyecto importado y las mismas variables en *Settings → Environment Variables* (Production).

## 2. Verificar la línea base

```bash
npm install
npm run check     # formato + lint + tipos + pruebas: debe quedar en verde
```

`npm test` incluye las pruebas de `ia/`, que demuestran que las restricciones de la IA funcionan.

## 3. Cómo se construye cada feature

1. El agente orquestador escribe la especificación con la skill `write-spec` y **te hace las preguntas abiertas**, una por una, con su propuesta.
2. Tú revisas la spec y la cambias a *Aprobada*. Sin eso, nadie escribe código.
3. El orquestador fija el contrato (`schema.ts`), delega a `backend` y `tests` por zonas e integra con `npm run check`.
4. `security` revisa en solo lectura; se aplican las correcciones.
5. Se escribe la nota de entrega en `docs/handoffs/` y se actualiza `docs/progreso.md`.
6. Prueba la API en local o en Vercel antes de pasar a la siguiente feature.

## 4. Primer mensaje (en OpenCode, en esta carpeta)

> Lee `AGENTS.md`, `docs/empezar.md`, `docs/arquitectura.md`, `docs/producto.md` y `docs/features.md`. Vamos a construir la API desde cero. Empieza por A0: usa la skill `write-spec` para escribir su especificación, hazme las preguntas abiertas una por una (con tu propuesta) y no implementes nada hasta que yo la apruebe.

## 5. Despliegue

Cuando exista la API (A0) se añadirán `npm run build` y `npm run start`. Entonces:

```bash
npm run build
vercel deploy --prod
```

Antes de desplegar, comprueba localmente `npm run build && npm start` y `GET /api/health`. Recuerda que `FIREBASE_PRIVATE_KEY` puede llegar con `\n` literales: normalízala al iniciar.

## 6. Problemas conocidos

| Síntoma | Causa | Qué hacer |
| --- | --- | --- |
| Un hook del guard falla al empezar | Aún no se instalaron dependencias | `npm install` |
| `CONFIGURATION_NOT_FOUND` al registrar | Authentication no está inicializado | Consola de Firebase → Authentication → *Get started* |
| `ERR_REQUIRE_ESM` en Vercel | `jwks-rsa` carga `jose` v6 (solo ESM) | Mantener los `overrides` de `package.json` |
| `npm run build` falla por variables | Faltan las `FIREBASE_*` en el entorno | Revisar Vercel o el `.env` local (tú, no el agente) |
