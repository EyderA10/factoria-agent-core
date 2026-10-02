# AGENTS.md

Instrucciones para agentes de IA que trabajan en este repositorio.

## Qué es

FactorIA Agent Core: núcleo **multi-tenant** de agentes de voz para varios clientes.
Un solo repositorio y un solo core sirven a N clientes. Cada tenant declara su
identidad, agente, tools y reglas de negocio en `config/tenants/<id>.json` (validado
con Zod) y el core se encarga del resto.

Alta de clientes = añadir un JSON. **No** añadir un handler, un endpoint ni un
widget por cliente.

## Stack

- Next.js 16.3.6 (App Router) · React 19.3 · Tailwind v4 · Zod 4
- `@elevenlabs/react` (widget) + `@elevenlabs/elevenlabs-js` (provisioning)
- Supabase Postgres + Drizzle ORM (persistencia operacional)
- Vitest · tsx · lucide-react
- Deploy: Vercel Production, disparado por push a `main`

## Comandos

```bash
npm run dev              # next dev
npm run build            # next build
npm run typecheck        # tsc --noEmit
npm test                 # vitest run

npm run setup:new        # genera config/tenants/<id>.json (interactivo o con flags)
npm run setup -- --tenant <id> --validate   # valida config; no toca nada
npm run setup -- --tenant <id> --diff       # compara ElevenLabs vs config
npm run setup -- --tenant <id>              # provisiona (idempotente)

npm run db:generate      # genera migraciones desde el schema de Drizzle
npm run db:migrate       # aplica migraciones
npm run db:studio        # GUI de Drizzle
```

Flags de provisioning: `--dry-run`, `--force-update`, `--rotate-secret`, `--list-clients`.
`--dry-run` no necesita `ELEVENLABS_API_KEY` (ni hace llamadas); sí necesita
`DATABASE_URL`, porque el servicio importa el repositorio.

### Gotcha del entorno

`npx` puede colgarse en esta máquina. Invoca los binarios directamente:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
./node_modules/.bin/next build
```

## Invariantes — no romper

Estos son el contrato del core. Si tocas algo aquí, es un cambio de arquitectura.

1. **El tenant se resuelve por el secret Bearer, nunca por el body.** Se hashea el
   secret del header `Authorization` y se compara (timing-safe) contra
   `tenants.secretHash`. Un `tenant_id` que envíe el LLM **nunca** se usa para
   autorizar. Es el único aislamiento entre clientes.
1b. **El aislamiento llega hasta los recursos del workspace de ElevenLabs.** El
   workspace es compartido por todos los clientes, así que nada se reutiliza por
   nombre pelado: las tools se nombran `<tenantId>__<tool>` (`buildWebhookToolName`),
   se reusan solo si además su `secret_id` del header es el del tenant
   (`findOwnTool`), y el agente se resuelve por `agents.elevenlabsAgentId` en DB, no
   por nombre. La URL del webhook sigue siendo `/api/tools/<tool>` pelada: el
   dispatcher enruta por ruta. En los canales outbound pasa igual: `telephony` y
   `whatsapp` resuelven número y `agentId` server-side, y el consumidor de WhatsApp
   nombra una **clave** de `whatsapp.templates`, nunca el nombre real de Meta (las
   plantillas se aprueban por WABA, así que el nombre libre le daría acceso a todas).
1c. **Un canal outbound solo expone lo que el consumidor debe decidir.** En ambos
   endpoints el cuerpo lleva el destino y, en WhatsApp, los datos que rellenan los
   placeholders de la plantilla. El resto —agente, número emisor, plantilla, idioma—
   sale del config del tenant. `template` es obligatoria a propósito: si quien llama
   manda el nombre de Meta en vez de la clave, la petición falla con `400` en vez de
   enviar en silencio una plantilla que no era la pretendida.
2. **El payload se valida con el contrato Zod derivado del `inputSchema` del tenant**
   *antes* de ejecutar el handler.
3. **Los handlers son genéricos y leen los datos de negocio de `tenant.settings`.**
   Un handler no debe conocer clientes concretos.
4. **Un tenant solo puede llamar a las tools de su config.** Semántica de respuestas
   del dispatcher: secret inválido → `401`; tool no declarada para ese tenant →
   `404`; payload inválido → `400`. No las cambies: son la prueba de aislamiento.
5. **El saludo lo emite el agente, no el widget.** `firstMessage` es del agente;
   el widget no hace push local de un saludo propio. El widget solo filtra el eco
   que ElevenLabs reproduce (`ECHO_WINDOW_MS`). Si readds un push local, aparecen
   saludos duplicados.
6. **El webhook valida HMAC** `v0=` + `t=`, con tolerancia de 30 min y comparación
   timing-safe. El timestamp de ElevenLabs viene en **segundos** (por eso
   `Number(timestamp) * 1000`): no lo "corrijas".
7. **Los secretos no se versionan.** El provisioning los imprime **una sola vez**:
   quedan como selector en el secret store del workspace de ElevenLabs (nunca en el
   body de la tool) y su hash en la tabla `tenants`.
1d. **`allowedOrigins` se normaliza y se valida en el schema, no en cada consumidor.**
   Salen canónicos (`esquema://host[:puerto]`, sin barra final, host en minúsculas)
   porque los dos consumidores no se comportan igual si no: `isOriginAllowed`
   compara cadenas exactas, mientras que el comodín de `frame-ancestors` **sí**
   vale en CSP. Sin normalizar, `https://cliente.com/` no cargaba el widget sin
   dar ningún error, y `https://*.cliente.com` ampliaba el framing a subdominios
   que la API seguía denegando. Se rechazan comodines, paths, credenciales y
   esquemas distintos de http/https: el error sale al validar el config.
8. **El embed se sirve siempre en un iframe de FactorIA.** La web del cliente pega
   `public/embed.js` y no recibe ni una clave ni un endpoint de sesión. Todo lo que
   se expone a terceros se decide con `allowedOrigins`, y esa lista vale a la vez
   para el `Origin` de la API y para `frame-ancestors` de `/embed/<tenant>`.

## Añadir un cliente

```bash
npm run setup:new                                          # 1. config/tenants/<id>.json
npm run setup -- --tenant <id> --validate                  # 2. valida
npm run setup -- --tenant <id> --diff                      # 3. qué cambiaría
npm run setup -- --tenant <id>                             # 4. provisiona
# 5. guarda el secret impreso en .env (o en Vercel) y reinicia
```

## Convenciones

- **Identificadores en inglés**; **textos de cara al usuario, comentarios de commit y
  documentación en español.**
- **No nombres proveedores internos en los documentos que ve el cliente.**
  `docs/onboarding-checklist.md` es un entregable que el cliente recibe y rellena
  (`> Entregable para el cliente`): ahí se habla de "FactorIA", "nuestro proveedor" o
  "la cuenta de Meta Business" (esa del cliente), nunca de ElevenLabs, Twilio, Vercel o
  Supabase, ni del workspace compartido. Escribe en términos de FactorIA, no de la
  cadena de montaje. El `README.md` y el runbook sí son internos y pueden nombrarlos.
- **Commits Conventional Commits** en español: `feat(core):`, `fix(ui):`, `docs(readme):`, `chore:`.
- **No añadas comentarios al código** salvo que te lo pidan explícitamente.
- **No sobre-documentes.** Si el código ya se explica solo, no añadas README ni comentarios.
- Valida con **Zod 4**. Reutiliza `getToolConfig` en lugar de reimplementar la
  resolución de config de tools.
- **El widget embebido vive en un iframe servido por FactorIA**, no inyectado en la web
  del cliente. Por eso su `fetch` a `/api/elevenlabs/session` es same-origin y no
  hace falta CORS. Si algún día se pasa a inyectar el widget directamente en la web
  del cliente, hay que añadir CORS y quitar `frame-ancestors`.
- El `targetOrigin` de `postMessage` es el origen de quien **recibe**. El resize del
  embed lo recibe la web del cliente, así que el iframe necesita el handshake
  `factoria-embed:init` para saber a qué origen publicar. Publicar con el propio
  origen se descarta en silencio.
- En el widget, los ids de mensajes deben salir de `nextIdRef` (por instancia), nunca de
  un contador a nivel de módulo: genera claves React duplicadas.
- **Reprovisionar crea tools nuevas**: al namespacear, el provisioning no encuentra
  las tools viejas y crea otras con id nuevo. Los agentes siguen apuntando a los ids
  anteriores hasta que corres `npm run setup -- --tenant <id> --force-update`, y las
  tools viejas quedan huérfanas en el workspace hasta que las borres a mano.
- **Diagramas de flujo en Markdown = Mermaid**, no ASCII. Ojo con el escapado, que
  depende del tipo de diagrama y en `sequenceDiagram` es contraproductivo:
  - En `flowchart` (etiquetas de nodo, que Mermaid renderiza como HTML) escapa `<` y
    `>` como `&lt;` y `&gt;`, o Mermaid los toma por etiquetas HTML.
  - En `sequenceDiagram` los actores y los mensajes **no** se renderizan como HTML:
    escribe `<tenant>` literal. Si lo escapas, el diagrama deja de parsear.
  - Evita `<br/>` en las etiquetas de arista.
  - Los paréntesis en el alias de `participant X as ...` sí valen.
  - Para comprobarlo sin abrir el navegador:
    `mermaid.parse(code)`, que no necesita DOM y detecta los errores de sintaxis.

## Trampas conocidas

- **El widget arranca muteado**, pero ElevenLabs abre el micrófono brevemente al crear
  la sesión y `setMuted()` no libera la pista: el indicador del navegador puede quedar
  encendido aunque no se envíe audio. No es un bug del core.
- En Vercel, **Preview y Development no tienen `DATABASE_URL`**: un deploy ahí falla.
  El flujo real es `main` → Production.
- En Vercel quedan variables que ya no usa el código (`FACTORIA_TOOL_SECRET`,
  `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`, `NEXT_PUBLIC_FACTORIA_DEMO_MODE`). No las leas
  como fuente de verdad: el config del tenant manda.
- El repositorio se renombró en GitHub a `factoria-agent-core`, pero **el proyecto de
  Vercel sigue siendo `factoria-agent-platform-poc`**. No renombres el proyecto de
  Vercel: `NEXT_PUBLIC_FACTORIA_BASE_URL` está grabado en las webhook tools que ya
  existen en ElevenLabs, y el dominio público cambiaría.
- Vercel requiere 4 variables en Production: `DATABASE_URL`, `ELEVENLABS_API_KEY`,
  `ELEVENLABS_WEBHOOK_SECRET` (Secret) y `NEXT_PUBLIC_FACTORIA_BASE_URL` (Config).
  Los `FACTORIA_TENANT_<X>_SECRET` **no** hacen falta en Vercel: el runtime valida
  contra el hash en DB. Solo los usa el provisioning local.

## Mapa de archivos

```
config/tenants/              fuente de verdad por tenant (Zod-validada)
lib/tenants/                 model.ts · store.ts · resolver.ts (hash → tenant)
lib/tools/                   Tool Layer: tipos, handlers, registry, ai.ts
lib/db/                      schema, cliente y repositorio (Drizzle)
lib/provisioning/service.ts  validate / diff / provision
lib/elevenlabs.ts            cliente + signed URL server-side
app/api/tools/[toolName]/    dispatcher: auth → tenant → Zod → handler → persist
app/api/elevenlabs/session/  sesión firmada
app/api/widget/config/       config pública white-label
app/api/webhooks/elevenlabs/ post-call: HMAC + persistencia
app/api/telephony/outbound-call/  llamada saliente (agentId y número server-side)
app/api/messaging/whatsapp/outbound-message/  mensaje saliente (plantilla por clave)
app/widget/[tenant]/         widget por tenant (página propia, para revisar)
app/embed/[tenant]/          lo que se embebe en la web del cliente
proxy.ts                     cabeceras de /embed (frame-ancestors por tenant)
public/embed.js              loader vanilla que el cliente pega en su web
lib/embed.ts                 contrato del embed y cabeceras de seguridad
components/                  factoria-chat-widget.tsx · factoria-embed-shell.tsx
tests/                       config, contrato Zod, aislamiento, handlers
docs/                        architecture-decisions · runbook-interno · onboarding-checklist
```

## Antes de dar por terminado

```bash
npm run typecheck && npm test && npm run build
```

Si tocaste el widget, el dispatcher, el webhook o el provisioning, prueba además el
comportamiento real (no solo los tipos): aislamiento entre tenants con dos secrets
distintos, y el flujo widget → sesión firmada → tool.
