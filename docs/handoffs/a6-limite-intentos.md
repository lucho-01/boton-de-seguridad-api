# Nota de entrega — A6 · Límite de intentos de login

## Entrega: orquestador · A6

**Hecho**
- Contador de fallos de login por par `correo + IP`: 5 fallos en 15 min → bloqueo de 15 min.
- Contador por IP sola: 20 fallos en 15 min → bloqueo de 15 min (anti-rociado de correos).
- El 5.º fallo responde `401`; el 6.º responde `429 "Demasiados intentos; espera unos minutos"` sin llamar a Firebase Auth.
- Solo cuentan los códigos de credenciales (`EMAIL_NOT_FOUND`, `INVALID_PASSWORD`, `INVALID_LOGIN_CREDENTIALS`, `INVALID_EMAIL`); `USER_DISABLED`, red y configuración no suman.
- Un login correcto borra ambos contadores; si el borrado falla, se registra el tipo y el login sigue.
- Fail-closed: si el almacén falla al verificar o al registrar un fallo, la respuesta es `500` opaco y no se consulta Auth.
- Las claves son hashes SHA-256 con prefijo (`par_`, `ip_`, `correo_`): nunca se guardan correo, IP ni contraseña en claro.
- Sin IP utilizable se degrada a contador por correo solo (modo `correo_`).
- 76 pruebas nuevas (545 en total), sin red, Firebase ni temporizadores reales.

**Archivos**
- Docs: `docs/specs/a6-limite-intentos.md`, `docs/adr/0012-limite-intentos-login.md`.
- Backend: `app/features/accounts/server/{intentos,intentos-service,intentos-repository,intentos-repository.memory,intentos-repository.firestore}.ts`, `app/features/accounts/server/cuentas-service.ts`, `app/api/auth/login/route.ts`, `app/features/container.ts`, `app/shared/server/time.ts` (`aIsoDesplazado`).
- Pruebas: `app/features/accounts/tests/{intentos-service,cuentas-login-limite,cuentas-service}.test.ts`, `app/api/tests/login-limite.test.ts`.

**Cómo verificar**
- `npm run check` → 545 pruebas, formato, lint y tipos en verde.
- `npm run build` → `ƒ /api/auth/login` (y el resto de rutas).
- 5 `POST /api/auth/login` con contraseña incorrecta → cinco `401`; el 6.º → `429` sin `detalles`.
- Con `x-forwarded-for` distinta, el par cambia y el login vuelve a intentarse.

**Decisiones**
- Umbral del par 5/15 min (spec) y umbral de IP sola 20/15 min (decisión de diseño anti-spray, ADR-0012).
- La ventana se reinicia si el último fallo cae fuera de los 15 min; el bloqueo cuenta desde el último fallo.
- `expira_en` se guarda como `Timestamp` para la política TTL de Firestore; aun sin TTL, un estado viejo se reinicia al leerlo por la ventana.
- El reinicio tras un éxito es best-effort: no se castiga a quien acertó; los documentos caducan solos.
- La IP se lee de la primera entrada de `x-forwarded-for` y, si falta, de `x-real-ip`; se descarta el puerto y los valores de más de 45 caracteres. Nunca se registra.

**Pendiente / bloqueos**
- Persona: crear la política TTL de Firestore sobre `intentos_login.expira_en`. Sin TTL, cada fallo deja 1–2 documentos que no se borran solos (la ventana solo reinicia el valor lógico) y la colección crece sin límite; verificar antes de desplegar.
- Persona: `.env`, Vercel y rotar la clave de servicio.
- Riesgo aceptado de A4 sigue abierto (token válido ≤1 h tras borrar la cuenta), documentado en ADR-0010.

**Revisión de seguridad**
- **Aprobado con observaciones** (revisión conjunta A4 + A5 + A6). Puertas: `typecheck`, `lint`, 545 pruebas y `npm audit --omit=dev` (0 en producción).
- **Medio — corregido:** la IP no se validaba y se tomaba el primer salto de `x-forwarded-for` (controlado por el cliente), lo que permitía rotarla y esquivar el límite del par. Ahora se prefiere `x-real-ip` (fijada por Vercel), se usa el **último** salto de `x-forwarded-for` y solo se aceptan direcciones válidas con `node:net.isIP`; cualquier otro valor cae al modo degradado por correo. Pruebas añadidas para `"abc"`, `"1"`, `"999.1.1.1"`, cadena larga y prioridad de `x-real-ip`.
- **Medio — residual aceptado y documentado (ADR-0012):** carrera `verificar → Auth → registrarFallo`; una ráfaga simultánea pasa la comprobación y llega a Auth. El ataque sostenido sí se frena. La prueba `A6 §8.11` fija el comportamiento (8 en paralelo → 8 llamadas a Auth, el 9.º → 429). Cerrarlo exige reservar el intento atómicamente antes de Auth con compensación en el éxito (spec nueva).
- **Bajo — residual aceptado:** un documento corrupto en `intentos_login` ya no provoca un `500` permanente: se trata como ausente y se reinicia el contador, con log solo del tipo.
- **Bajo — residual aceptado:** hash sin *pepper*; con Firestore filtrado se podría confirmar por diccionario qué correos tienen contador. Evita el dato en claro; un pepper por variable de entorno requiere ADR.
- **Bajo — residual aceptado:** 20 fallos desde un NAT/CGNAT pueden bloquear 15 min a otros usuarios de esa IP (umbral aprobado en la spec).
- **Informativo:** `POST /api/auth/registro` responde 409 si el correo existe (oráculo de existencia), comportamiento heredado de A1 y ajeno a A6.
- **Informativo:** `npm audit` reporta 12 moderadas solo en devDependencies (ESLint/Vitest); 0 en producción.

**Estado final:** `npm run check` → **545 pruebas** en verde; `npm run build` compila todas las rutas.
