# ADR-0012 · Límite de intentos de login: contadores con hash, ventana y TTL

- **Estado:** Aceptada
- **Fecha:** 2026-11-16
- **Quién decide:** el equipo (proyecto de curso)

## Contexto

El login delega la contraseña en Firebase Auth, que aplica sus propias cuotas. Aun así, la API necesita un freno propio para no gastar cuota, responder rápido ante fuerza bruta y no revelar si un correo existe. Con Vercel (varias instancias y reinicios) un contador en memoria no protege de verdad.

## Decisión

- **Dos contadores por intento fallido:** par `correo + IP` (umbral 5) e `IP` sola (umbral 20), ambos en ventana de 15 minutos; el bloqueo dura 15 minutos.
- **Momento:** se consulta el bloqueo **antes** de llamar a Firebase, después de validar el cuerpo; solo suma un `401` de credenciales.
- **Éxito reinicia:** un login correcto borra ambos contadores.
- **Persistencia:** colección `intentos_login` en Firestore, con transacción para leer-calcular-guardar y TTL en `expira_en` (24 h). El identificador es un SHA-256 del par o de la IP; nunca se guarda el valor en claro.
- **Decisión pura:** sumar, bloquear o reiniciar es una función del servicio con el reloj inyectado; el repositorio solo hace la transacción.
- **IP:** `x-real-ip` (la fija el borde de Vercel y el cliente no la sobrescribe); si falta, el **último** salto de `x-forwarded-for`, que es el que añade el proxy de confianza. Solo se aceptan direcciones válidas (`node:net.isIP`); cualquier otro valor se descarta y aplica el modo degradado por correo. Sin IP, solo aplica el contador del correo, nunca un contador global compartido.
- **Contrato intacto:** mismos 400/401/403/415/200 y el mismo mensaje de 429 de A1; sin cabeceras nuevas.
- **Fallo del almacén:** verificar o registrar un fallo responde 500 (no se salta el límite); un fallo al reiniciar tras un login correcto solo se registra y se responde 200.

## Alternativas consideradas

- **Contador solo por correo:** un tercero puede bloquear la cuenta de la víctima intentando con su correo. Rechazada por la persona.
- **Contador solo por IP:** un ataque distribuido contra una cuenta no se frena. Rechazada.
- **Memoria del proceso:** no sobrevive reinicios ni es compartida entre instancias de Vercel. Rechazada.
- **Bloqueo progresivo o permanente:** difícil de explicar y de probar; se puede añadir después. Rechazada.
- **Contar también registro y refresh:** amplía el alcance sin una necesidad demostrada. Rechazada.

## Consecuencias

- Se crea la colección `intentos_login`; la persona debe activar la política TTL de Firestore sobre `expira_en` (operación de consola/gcloud, documentada en el handoff). Si no la activa, los documentos viejos se reinician al leerse y no rompen la regla.
- Un atacante puede gastar 5 intentos por par, pero no bloquear a la víctima desde otra IP ni gastar la cuota de Firebase sin llegar al umbral de IP.
- El `429` no distingue correo existente de inexistente, igual que el `401` de A1.
- El hash SHA-256 sin pepper no impide un ataque de diccionario sobre correos conocidos, pero evita guardar el dato en claro; si la persona quiere, A6 puede añadir un pepper por variable de entorno.
- **Residual aceptado — carrera verificar → Auth → registrar:** `verificar` solo lee; el fallo se anota cuando Firebase responde. Una ráfaga simultánea pasa la comprobación antes de que el contador llegue al umbral, así que el límite no frena el pico (sí frena el ataque sostenido). La prueba `A6 §8.11` fija el comportamiento: 8 intentos paralelos llegan a Auth, el contador queda en 8 y el siguiente secuencial recibe `429`. Cerrarlo del todo exige reservar el intento de forma atómica antes de Auth y compensarlo en el éxito; se hará con spec nueva si el riesgo lo justifica.
- **Residual aceptado — NAT compartido:** el umbral de IP sola (20/15 min) permite que 20 fallos desde un CGNAT bloqueen temporalmente a otros usuarios de esa IP. El umbral es deliberadamente alto; se revisará si aparecen quejas.
- **Residual aceptado — documento corrupto:** un documento con forma inválida en `intentos_login` se trata como ausente y se reinicia el contador (con log de tipo), en vez de provocar un `500` permanente para esa clave.
- **Operación pendiente:** la política TTL sobre `intentos_login.expira_en` es manual. Sin ella, cada fallo deja 1–2 documentos que no se borran solos (la ventana solo reinicia el valor lógico); la colección crecería sin límite. Debe verificarse antes de desplegar.
