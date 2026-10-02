# Runbook interno — FactorIA Agent Core

## 1. Mapa del sistema

| Pieza | Ruta | Qué sabe de otros tenants |
|---|---|---|
| Config por tenant | `config/tenants/<id>.json` | nada: cada uno es su propio config |
| Dispatcher de tools | `app/api/tools/[toolName]/` | solo el suyo: se resuelve por secret |
| Sesión de widget | `app/api/elevenlabs/session` | solo el suyo: `?tenant=` + rate limit |
| Llamada saliente | `app/api/telephony/outbound-call` | solo el suyo: auth por secret |
| Post-call webhook | `app/api/webhooks/elevenlabs` | ninguno: el tenant sale de `agent_id` |
| Config pública | `app/api/widget/config` | ninguno: sin `agentId` ni reglas |

El workspace de voz es **compartido**: el aislamiento no lo da el proveedor, lo da el
core (secret → tenant → recursos). Por eso las tools se nombran `<tenantId>__<tool>` y
el agente se resuelve por `agents.elevenlabsAgentId` en DB.

## 2. Superficie pública y sus defensas

| Endpoint | Auth | Cuota (configurable en `lib/ratelimit/limiter.ts`) | Origen |
|---|---|---|---|
| `POST /api/tools/<tool>` | Bearer del tenant | — | — |
| `GET /api/elevenlabs/session` | ninguno (público por diseño del widget) | `10/min` por IP + `60/h` por tenant | `allowedOrigins` del tenant |
| `POST /api/telephony/outbound-call` | Bearer del tenant | `30/h` por tenant | — |
| `POST /api/webhooks/elevenlabs` | HMAC `v0=`/`t=` | — | — |
| `GET /api/widget/config` | ninguno | — | — |
| `GET /embed/<tenant>` | ninguno | — | `frame-ancestors` desde `allowedOrigins` |
| `GET /embed.js` | ninguno | — | — |

Notas que importan al operar:

- El rate limiting **degrada a permitir** si Postgres no responde. Es deliberado: es
  peor perder contabilidad que devolver 500 en un endpoint público. Si el store está
  caído, el aviso real es el del propio Postgres.
- `allowedOrigins: []` significa **embed cerrado**: ninguna web de terceros puede
  cargar el widget de ese tenant. Es la postura segura por defecto. Se llena con el
  dominio real que da el cliente en el onboarding (checklist §6); los tenants del repo
  solo tienen `http://localhost:3000` porque aún no se ha hecho su onboarding web.
  Sin cabecera `Origin` la comprobación pasa siempre: no es un embebido de terceros.
- El `/api/widget/config` solo permite enumerar tenants fuera de producción, y el índice
  `/widget` devuelve `404` en producción.
- `/embed/<tenant>` es la superficie que se expone a páginas de terceros: por eso es la
  única con CSP de `frame-ancestors`. `/embed.js` es un fichero estático sin lógica de
  negocio; todo lo que decide algo está en el iframe.

## 3. Alta de un tenant

```bash
npm run setup:new -- --id <id> --name "<nombre>" --tools reserve_table,check_weather \
  --tagline "<saludo>" --color "#B45309" --icon "🍽️"
npm run setup -- --tenant <id> --validate
npm run setup -- --tenant <id> --diff
npm run setup -- --tenant <id>
```

Guarda el secret impreso (sale **una sola vez**) en `.env`. Añade `telephony.agentPhoneNumberId`
al config si el tenant va a marcar llamadas.

## 4. Operación diaria

### Ver conversaciones de un tenant

```sql
SELECT id, elevenlabs_conversation_id, started_at, ended_at
FROM conversations WHERE tenant_id = '<id>' ORDER BY id DESC LIMIT 20;
```

Los mensajes y las tool calls cuelgan de `conversation_id`, que puede venir `NULL` si la
tool se ejecutó antes de que el webhook creara la conversación. Es esperado.

### Contadores del rate limiting

```sql
SELECT scope, key, count, window_start FROM rate_limit_counters
WHERE window_start > now() - interval '24 hours' ORDER BY count DESC;
```

Las ventanas viejas se limpian oportunísticamente (cada alta borra las de más de 24 h). Si
la tabla crece, se puede borrar a mano: es caché, no fuente de verdad.

### Auditar llamadas salientes

```sql
SELECT started_at, to_number, status FROM outbound_calls WHERE tenant_id = '<id>';
```

## 5. Troubleshooting

| Síntoma | Causa más probable | Qué hacer |
|---|---|---|
| Widget: "falta ?tenant=" | el embedder no lo manda | probar `/api/widget/config?tenant=<id>` y pasar el slug |
| **El widget no aparece en la web del cliente** | `frame-ancestors` no incluye su origen | meter su URL exacta en `allowedOrigins`. Comprobar con `curl -I https://EMBED_HOST/embed/<id>` y leer el CSP |
| **El iframe aparece pero en blanco o sin bubble** | su CSP bloquea `frame-src`/`script-src` hacia `EMBED_HOST` | que el cliente añada `EMBED_HOST` a su lista blanca |
| **El micrófono no pide permiso** | su `Permissions-Policy` no incluye `EMBED_HOST` | que mande `microphone=(self "https://EMBED_HOST")` |
| **El iframe no cambia de tamaño al abrir el panel** | el handshake `factoria-embed:init` no llegó | solo debería pasar si alguien cambió el protocolo; ver §6 |
| Sesión `429` | cuota agotada | ver la tabla de contadores; es IP o tenant |
| Sesión `403` por origen | `allowedOrigins` no incluye el dominio | añadir el dominio exacto (comparación literal) |
| Outbound `401` | falta o mal el Bearer | el secret es el que imprimió el provisioning |
| Outbound `503` `telephony_not_configured` | el tenant no tiene número | importar el número y poner `agentPhoneNumberId` |
| Outbound `404` | el tenant no está en DB | provisionar |
| Tools `401` / `404` | secret inválido / tool no declarada | esperado: es la prueba de aislamiento |
| Webhook `401` | firma `v0=` incorrecta o secret distinto en Vercel | comparar `ELEVENLABS_WEBHOOK_SECRET` |
| Duplicados en `messages` | fijo desde la migración `0005` | comprobar `events.dedupe_key` |

## 6. Cómo funciona el embed

```
web del cliente                 core.factoria.ai
───────────────                 ────────────────────────────
<script src=.../embed.js>  ──▶  /embed/<tenant>
        │                            │
        │  crea <iframe>             │  renderiza burbuja + panel
        │  ◀── factoria-embed:init ──┤  (te dice su origen)
        │  factoria-embed:resize ──▶ │  (mide el DOM con ResizeObserver)
```

Tres decisiones que conviene no deshacer sin pensarlo:

- **El loader no llama a ninguna API.** Todo ocurre dentro del iframe, que ya está en
  nuestro origen. Por eso **no hay CORS**: añadir cabeceras `Access-Control-*` al
  embed solo abriría la puerta de entrada.
- **`frame-ancestors` sale de `allowedOrigins`**, la misma lista que valida el
  `Origin` de `/api/elevenlabs/session`. Una sola lista para las dos cosas.
- **No hay `X-Frame-Options`.** `ALLOW-FROM` no tiene soporte en ningún navegador
  actual, así que la única directiva posible sería `DENY`, que rompería los orígenes
  permitidos.

El `targetOrigin` del `postMessage` es **el origen de quien recibe**, que en este caso
es la web del cliente, no FactorIA. Publicar el tamaño con nuestro propio origen hace
que el navegador lo descarte en silencio; por eso existe el handshake `init`. Si algún
día hay que tocar el protocolo, hay tests en `tests/embed.test.ts` que comprueban que
los dos lados usan los mismos nombres de mensaje.

Probar el embed de un tenant:

```bash
curl -I https://EMBED_HOST/embed/<id>   # el CSP debe traer su origen
curl -s https://EMBED_HOST/embed/<id> | grep -c elevenlabs   # 0
```

El segundo comando no debería encontrar nada: la web del cliente no tiene por qué ver
el nombre del proveedor. El widget siempre habla con `/api/elevenlabs/session` desde
dentro del iframe.

## 7. Rotar un secret

```bash
npm run setup -- --tenant <id> --rotate-secret
```

Actualiza `.env` (o Vercel), redeploya y descarta el valor anterior. No hace
falta definir `FACTORIA_TENANT_<X>_SECRET`: el runtime valida contra el hash en DB.


## 8. Capabilities del proveedor de voz

| Capacidad | Vía API | Manual (dashboard) | En el core |
|---|---|---|---|
| Crear / actualizar agente (guion, tools, voz) | ✅ | ✅ | ✅ `scripts/setup.ts` (`--force-update`) |
| Tool webhook a tu API | ✅ `tools.create` | ✅ | ✅ |
| Tool cliente (callback del navegador) | ✅ | ✅ | ⏳ |
| Signed URLs para el widget | ✅ | — | ✅ `app/api/elevenlabs/session` |
| WebRTC desde el navegador | ✅ SDK | — | ✅ widget propio |
| `userId` y variables dinámicas por sesión | ✅ | — | ✅ |
| Post-call webhooks (transcripción, audio, coste) | ✅ | ✅ | ✅ con HMAC e idempotencia |
| Coste de llamadas (`metadata.cost`) | ✅ | ✅ | ✅ persistido en el evento |
| Llamada saliente | ✅ | ✅ | ✅ `app/api/telephony/outbound-call` |
| Verificación HMAC de webhooks | ✅ | — | ✅ a mano (`t=`/`v0=`, 30 min) |
| Autenticación de agentes | ✅ | ✅ | ✅ allowlist + signed URL |
| Voz: clonar, estilizar, 29+ idiomas | ✅ | ✅ | ⏳ |
| Números entrantes / asignación a agente | parcial (import) | ✅ | ⏳ requiere credenciales |
| Transferencia a humano | ✅ system tool | ✅ | ⏳ depende de datos del cliente |
| WhatsApp inbound | import vía cuenta de Meta | ✅ | ⏳ requiere WABA |
| WhatsApp outbound | ✅ (plantillas) | ✅ | ✅ `app/api/messaging/whatsapp/outbound-message` |

**Lo que no se puede automatizar.** El alta de WhatsApp se hace desde Integraciones
iniciando sesión en la cuenta de Meta Business: requiere permisos de administrador,
un número sin uso previo de WhatsApp y método de pago en el manager de Meta. La
asignación de número a agente y la grabación de llamadas se hacen en el dashboard por
cliente. El enrutamiento a CRM es responsabilidad del Tool Layer, no del proveedor.

**Telephony provider.** La integración nativa del workspace es con Twilio (import por
API); el resto de proveedores (SIP, Vonage, Telnyx, Plivo, Bandwidth, Exotel) se conectan
por dashboard. El core solo depende de que exista un `agentPhoneNumberId`, así que
cambiar de proveedor no toca código.

**Transferencia a humano.** El destino se declara en `telephony.transfers` del config y
lo elige el agente por su `condition`; nunca puede inventarse un número. Al provisionar
sale como la system tool `transfer_to_number` en `agent.prompt.built_in_tools`. Solo
funciona en llamadas entrantes: para que las haya, el número debe estar importado y
asignado al agente, que es lo que hace ElevenLabs al vincularlo. **No hace falta código
de inbound en el core**: el proveedor entrega la llamada al agente.

Cuidado con `--force-update`: el PATCH **reemplaza** `built_in_tools` entero, así que una
system tool puesta a mano en el dashboard desaparecería. El provisioning las relee y las
reenvía, pero conviene no tocar las tools del agente desde el dashboard.

**SDKs instalados.** `@elevenlabs/elevenlabs-js` 2.68.0 (server: agentes, tools, signed
URLs, outbound, post-call) y `@elevenlabs/react` 1.15.2 (cliente: `ConversationProvider`,
`useConversationControls`, `useConversationStatus`, `useConversationInput`).

**Regla de trabajo.** Lo que se puede reproducir por código va en
`lib/provisioning/service.ts` vía `scripts/setup.ts`, con el config del tenant como
fuente de verdad. Lo sensible o que varía por cliente (voz fina, plantillas de WhatsApp,
números) se deja en el dashboard y se recoge en el checklist de onboarding.

## 9. Estado de los canales

| Canal | Endpoint | Estado | Validado en producción | Falta para cerrarlo |
|---|---|---|---|---|
| Web (widget) | `/api/widget/config`, `/api/elevenlabs/session` | ✅ funcionando | signedUrl emitida, agente correcto | — |
| Tool Layer | `/api/tools/<tool>` | ✅ funcionando | `check_weather` con datos reales de Open-Meteo | — |
| Telefonía outbound | `/api/telephony/outbound-call` | ⏳ código listo, sin probar contra la API | `503 telephony_not_configured` (correcto) | Importar un número a ElevenLabs y declarar `telephony.agentPhoneNumberId` |
| WhatsApp outbound | `/api/messaging/whatsapp/outbound-message` | ⏳ código listo, sin probar contra la API | `503 whatsapp_not_configured` (correcto) | WABA de Meta + plantillas aprobadas + `whatsapp.phoneNumberId` |
| WhatsApp inbound | — | ⏳ no implementado | — | WABA vinculada al agente (manual) |

**Los `503` son el resultado correcto**, no un fallo: significan que el core
llegó hasta la última comprobación (autenticación, aislamiento y cuota ya pasaron) y
se detuvo en la única pieza que depende de una cuenta del cliente. En cuanto el
tenant declare el identificador, la misma llamada avanza contra la API real.

**Plantillas de WhatsApp.** El tenant declara en `whatsapp.templates` a qué plantillas
tiene derecho; el consumidor del endpoint manda la clave, nunca el nombre real de Meta.
El idioma sale del config porque cada plantilla se aprueba para un idioma concreto:

```jsonc
"whatsapp": {
  "phoneNumberId": "<id del número en ElevenLabs>",
  "templates": {
    "confirmacion": { "name": "confirmacion_reserva_v2", "languageCode": "es" }
  }
}
```

Un envío se pide entonces con `template: "confirmacion"`; una clave que el tenant no
declare devuelve `400` con la lista de las que sí.

**El destino es solo dígitos, sin `+`.** ElevenLabs espera el WhatsApp user ID con
código de país y sin signo más (`573001234567`). El endpoint acepta el número con o
sin `+` y lo normaliza antes de llamar a la API. Ojo con las tools de WhatsApp de
ElevenLabs, que usa el agente en conversación: ahí el `+` lo pone el LLM y Meta
rechaza el mensaje, así que el prompt del agente tiene que pedir los dígitos.

**Lo que se requiere por cada canal saliente.**

- *Telefonía:* un número con voz en el proveedor (hoy Twilio vía import por API).
  FactorIA lo importa desde el dashboard, y luego el core solo referencia su
  `agentPhoneNumberId`. El proveedor no está cableado en el código.
- *WhatsApp:* una cuenta de Meta Business con WABA, un número habilitado en
  WhatsApp Business, método de pago en el manager de Meta y **plantillas
  aprobadas**, declaradas como arriba. Meta no admite mensajes libres: todo envío
  saliente va por plantilla, y sin aprobación la API responde 422 aunque el código
  sea correcto.
- *Ambos:* vincular el número al agente desde el dashboard de ElevenLabs. El core no
  lo puede hacer por API, y así el número no queda en manos de quien llama al
  endpoint.

**Lo que aún no se ha probado de extremo a extremo.** La conversación de voz real
(widget → micrófono → agente → tool) necesita un navegador con micrófono; la
validación hecha fue por HTTP contra los endpoints. El webhook post-call (HMAC,
idempotencia y persistencia de transcripción/coste) tampoco se ha disparado con una
llamada real: solo está cubierto por tests. Ambos son el siguiente paso natural en
cuanto haya una llamada o un número de verdad.

## 10. Futuro

Redis (rate limiting) y Langfuse (trazabilidad) están arquitecturados y diferidos. El
rate limiting ya pasa por la interfaz `RateLimiter`, así que el día que se mueva a Redis
solo cambia `lib/ratelimit/postgres.ts`.