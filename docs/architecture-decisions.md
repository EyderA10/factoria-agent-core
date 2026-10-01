# Architecture decisions — FactorIA Agent Core

Registro de las decisiones de arquitectura.
Cada decisión dice **qué** se decidió, **por qué** y **qué se descarta si cambia**.

---

## 1. El config del tenant es la fuente de verdad; la DB materializa estado

**Decisión.** `config/tenants/<id>.json` (validado con Zod por `lib/tenants/model.ts`)
es la definición del tenant. La tabla `tenants` guarda lo operativo: `secret_hash`,
`enabled`, `branding`, `config_version`, timestamps.

**Por qué.** El provisioning tiene que ser reproducible y auditable ("¿qué se le dio
a este cliente?"), y un panel web futuro necesita el *mismo* modelo, no un segundo
formato. Con config en repo, el diff es un `git diff`.

**Se descarta si.** El cliente necesita editar su config en caliente sin deploy →
entonces el panel escribe el mismo modelo contra la DB y el repo pasa a ser backup.

## 2. El tenant se resuelve por hash del secret, nunca por el body

**Decisión.** Cada tenant tiene su propio secret Bearer. El core hashea
(`sha256`) el `Authorization` recibido y lo compara en tiempo constante contra
`tenants.secret_hash` (`lib/tenants/resolver.ts`). El `tenant_id` del payload, si
llega, se ignora. En el webhook post-call el tenant sale de `agent_id → agents`.

**Por qué.** Es la única forma de que el mismo endpoint sirva a N clientes sin que el
LLM pueda auto-asignarse el tenant equivocado. Un `tenant_id` en el body es
controlado por el modelo.

**Consecuencia operativa.** El secret solo se muestra una vez, en el provisioning.
Rotar = `--rotate-secret`.

## 3. Un solo endpoint de tools, tools declarativas por tenant

**Decisión.** `POST /api/tools/[toolName]`. El *qué* (contrato JSON) y el *con qué
datos* (`settings`) los declara el tenant; el core aporta el handler genérico.

**Por qué.** Evita un endpoint por cliente y hace auditable qué puede pedir cada
agente. El contrato Zod se **deriva** del `inputSchema` del config, así que no puede
haber drift entre lo que se le declara a ElevenLabs y lo que el core valida.

**Consecuencia.** Un handler nuevo (p. ej. `check_booking`) se agrega una vez en
`lib/tools/` y queda disponible para todo tenant que lo declare.

## 4. Persistencia operacional en Supabase Postgres (Drizzle)

**Decisión.** Postgres como sistema de registro: `tenants`, `agents`,
`conversations`, `messages`, `tool_calls`, `events`. Acceso por `postgres-js` contra
el *transaction pooler* (puerto 6543, `prepare: false`, 1 conexión) por compatibilidad
con serverless.

**Por qué.** El caso de uso es "consultar conversaciones y tool calls por tenant" y
auditoría. Una base vectorial daría complejidad sin resolver ese problema.

**Se descarta si.** Aparecen búsquedas semánticas sobre transcripciones → se agrega
pgvector o Langfuse, sin cambiar la capa de acceso.

## 5. Redis (Upstash) y Langfuse: arquitecturados, diferidos

**Decisión.** No se implementan en esta fase. El punto de extensión es `lib/db/repo.ts`
(todo acceso a datos pasa por ahí) más la tabla `events`, que ya recibe los eventos
crudos del webhook con `payload_json`.

**Por qué.** Se prefieren interfaces ("ports") sobre implementaciones prematuras: el
shape del evento ya está definido, así que activarlos después es un insert, no un
refactor.

**Actualización (rate limiting).** El primer consumidor de Redis sería el rate limiting
de los endpoints públicos, pero se resolvió sobre Postgres: la tabla
`rate_limit_counters` con *upsert* atómico y la interfaz `RateLimiter`
(`lib/ratelimit/limiter.ts`) ya dan el comportamiento requerido a la escala actual. Si
el volumen o la latencia obligan a moverlo, `lib/ratelimit/postgres.ts` se sustituye
por un adaptador y ninguna ruta cambia.

## 6. Integración externa real: Open-Meteo (sin API key)

**Decisión.** `check_weather` consulta Open-Meteo (forecast diario, sin credenciales).
La latitud/longitud y el umbral de lluvia vienen del `settings` del tenant.

**Por qué.** La prueba de aceptación exige correr una tool contra una fuente externa
*real*. Open-Meteo no requiere signup, lo que hace la prueba reproducible para
cualquiera que clone el repo.

**Consecuencia.** El handler es genérico: cambiar de proveedor es cambiar el `fetch`.

## 7. Provisioning: servicio reutilizable + CLI fina

**Decisión.** `lib/provisioning/service.ts` expone `validateTenant`, `diffTenant` y
`provisionTenant`; `scripts/setup.ts` solo parsea flags e imprime. El flujo es
secret → webhook tools → agente → estado en DB, idempotente.

**Por qué.** Se requiere que un panel web futuro use exactamente la misma lógica que
la CLI. Si la lógica viviera en el script, habría dos implementaciones.

**Notas técnicas.** El agente se crea por REST (`/v1/convai/agents/create`) porque el
enum `Llm` del SDK no incluye los modelos flash usados por los tenants; el resto va
por SDK. Los TTS v2.5 tampoco están en el enum del SDK.

## 8. `conversation_id` nullable y sin default; índices de lookup NO únicos

**Decisión.** En `tool_calls` y `messages`, `conversation_id` es `integer` **nullable y
sin `DEFAULT`** (referencia a `conversations.id`), y los índices `messages_conversation_idx`,
`tool_calls_tenant_idx` y `events_tenant_type_idx` son `index`, no `uniqueIndex`.

**Por qué.** Son la fuente de dos bugs silenciosos que solo aparecen en la primera
escritura real:

1. Una columna declarada con `serial()` mantiene su `DEFAULT nextval(...)` aunque se
   cambie a `integer` sin default; Drizzle genera el `DEFAULT` en el INSERT, la fila
   intenta apuntar a `conversations.id = 1` y revienta la FK (`tool_calls_conversation_id_conversations_id_fk`).
   En este caso era además doble: la secuencia estaba desfasada respecto a los `serial`
   insertados a mano, así que generaba ids inexistentes.
2. Declarar como `uniqueIndex` un índice de consulta (tenant + tool, tenant + event type,
   conversation) limita la tabla a **una fila por combinación**, por lo que la segunda
   llamada de la misma tool del mismo tenant falla con violación de unicidad.

**Consecuencia práctica.** Las tool calls se persisten aunque la conversación aún no
exista (el webhook post-call la crea después y la enlaza por `elevenlabs_conversation_id`);
y el log de una tool debe poder mostrar N llamadas por tenant.

**Cómo se evita.** Migraciones `0001` (tipo + `DROP DEFAULT`) y `0003` (índices no
únicos). Si se declara un id con `serial()` y luego se pasa a `integer` nullable,
hay que añadir explícitamente `ALTER COLUMN ... DROP DEFAULT`: `drizzle-kit generate`
no lo detecta.

## 9. Idempotencia del webhook post-call por clave derivada

**Decisión.** `events.dedupe_key` es un SHA-256 de `type|conversation_id|event_timestamp`
y tiene índice único. El evento se registra **antes** de procesar el payload; un
`ON CONFLICT DO NOTHING` que no inserta significa reintento, y se responde `200` sin
volver a escribir mensajes.

**Por qué.** ElevenLabs reintenta el post-call si el endpoint no responde a tiempo, y el
payload real no trae un `event_id` propio. La clave sale de los tres campos que sí
identifican un evento único. `dedupe_key = NULL` desactiva la deduplicación para eventos
sin timestamp, y en SQL los `NULL` no colisionan en un índice único, así que los
eventos históricos quedan intactos.
