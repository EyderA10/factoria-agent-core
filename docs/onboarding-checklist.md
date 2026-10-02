# Checklist de Onboarding — FactorIA Agent Platform

> Entregable para el cliente. Rellénalo y devuélvelo a FactorIA; luego lo aplicamos al agente.
> Contacto: [email / teléfono de FactorIA]

- **Parte A** es lo que necesitamos que respondas.
- **Parte B** es lo que hacemos nosotros con esa información, para que sepas qué
  depende de ti en cada paso.

---

## Parte A — Lo que necesitamos del cliente

### 1. Datos de la empresa

| Campo | Respuesta |
|---|---|
| Razón social / marca | |
| Persona de contacto | |
| Email de contacto | |
| Teléfono de contacto | |
| Rubro / descripción breve | |
| Canales que quiere habilitar (Web · WhatsApp · Teléfono) | |

### 2. Qué debe hacer el agente

| Consulta / tarea | Sí | No |
|---|---|---|
| Responder preguntas frecuentes (FAQ) | ☐ | ☐ |
| Ofrecer productos / servicios | ☐ | ☐ |
| Vender / reservar (checkout, disponibilidad) | ☐ | ☐ |
| Consultar disponibilidad de espacios | ☐ | ☐ |
| Agendar citas / turnos | ☐ | ☐ |
| Consultar estado de pedidos | ☐ | ☐ |
| Transferir a un humano | ☐ | ☐ |
| Otros: | ☐ | ☐ |

### 3. Negocio y horarios

| Pregunta | Respuesta |
|---|---|
| Idioma(s) de atención | |
| Horario de atención (días y horas) | |
| Zona horaria (ej. América/Bogotá) | |
| ¿Disponibilidad en tiempo real u horarios estáticos? | |
| ¿Precios? ¿Se cobra o solo se informa? | |

### 4. Fuentes de datos para la integración (Tools)

| Fuente | Tipo (API / base de datos / hoja) | URL / servidor | Cómo autenticarse | Persona a cargo |
|---|---|---|---|---|
| Disponibilidad | | | | |
| Catálogo / precios | | | | |
| Agenda / reservas | | | | |
| CRM / clientes | | | | |
| Búsqueda de asesor humano | | | | |

### 5. Clientes y datos personales

| Pregunta | Respuesta |
|---|---|
| ¿Qué datos del cliente se recogen en las llamadas? | |
| ¿Se autoriza grabación y transcripción? (requisito legal) | |
| ¿Tienen Política de Tratamiento de Datos / encaje RGPD? | |
| ¿Se deben anonimizar datos antes de usar herramientas de IA? | |
| Persona responsable de datos (DPO/encargado) | |

### 6. Web (widget embebible)

| Pregunta | Respuesta |
|---|---|
| URL(s) del sitio donde irá el widget | |
| ¿En qué página(s)? (portada, contacto, todas) | |
| Apariencia (color, icono, nombre, saludo) | |
| ¿Quieren la burbuja abierta por defecto al entrar? | |
| ¿Alguien del equipo técnico del cliente lo instala? | |

El cliente pega **un `<script>`** y nada más. No hay snippet de React, ni SDK, ni
clave de API que guardar en su web:

```html
<script
  src="https://EMBED_HOST/embed.js"
  data-tenant="ID_DEL_TENANT"
  defer
></script>
```

Ese script crea un iframe anclado abajo a la derecha, en nuestro dominio. El widget,
la sesión y el micrófono viven dentro de ese iframe, no en la web del cliente.

**Lo que pone FactorIA** (antes de entregar el snippet):

1. Meter la URL del cliente en `allowedOrigins` de `config/tenants/<id>.json`. Esa
   lista es la que decide qué webs pueden embeber el widget; con la lista vacía no
   se muestra nada. Solo el esquema y el host, y **sin barra final**
   (`https://mesa-y-cia.com`). El config se autocomprueba al cargarlo: acepta
   `https://Cliente.com/` y lo deja en `https://cliente.com`, pero **rechaza** un
   comodín (`https://*.mesa-y-cia.com`), un path o cualquier esquema que no sea
   `http`/`https`, en vez de aceptarlos y dejar el embed a medias.
2. Provisionar el tenant y darle de alta el `FACTORIA_TENANT_<ID>_SECRET`.

**Lo que tiene que habilitar el cliente** en su web:

- **HTTPS.** El micrófono no funciona en un iframe `http://` salvo en `localhost`.
- **`Permissions-Policy: microphone=(self "https://EMBED_HOST")`** en su respuesta, si
  su servidor manda esa cabecera. Sin esto el navegador deniega el micrófono aunque
  todo lo demás esté bien.
- Nada de CSP que prohíba `frame-src`, `script-src` o `child-src` hacia `EMBED_HOST`.
  Si su web tiene una CSP restrictiva, hay que añadirla a la lista blanca.

Para probar sin tocar la web del cliente: `/widget/<id>` sirve el mismo widget en
una página propia, y `/embed/<id>` es exactamente lo que se embebe.

### 7. WhatsApp

| Pregunta | Respuesta |
|---|---|
| ¿Tienen un número de WhatsApp Business activo? | ☐ Sí ☐ No |
| Número de WhatsApp Business | |
| ¿Otro número disponible (sin WhatsApp) por si se requiere reconectar? | |
| Plantillas aprobadas para mensajes proactivos (promociones, recordatorios) | |

### 8. Telefonía (opcional)

| Pregunta | Respuesta |
|---|---|
| ¿Número(s) actual(es)? | |
| ¿Proveedor telefónico actual? | |
| ¿Buscan portabilidad / número nuevo? | |
| ¿Llamadas entrantes, salientes o ambas? | |
| ¿Transferencia a humano en una extensión / número interno? | |

### 9. Voz y estilo del agente

| Pregunta | Respuesta |
|---|---|
| Nombre del agente (ej. «Aura») | |
| Personalidad / tono (formal, cercano…) | |
| Voz preferida (género, estilo) | |
| Primer mensaje de saludo | |

### 10. Pruebas y lanzamiento

| Pregunta | Respuesta |
|---|---|
| Usuarios de prueba (email / WhatsApp / teléfono) | |
| Fecha objetivo de lanzamiento | |
| ¿Plan de entrenamiento de los agentes humanos? | |
| Nivel de supervisión inicial (escucha de llamadas) | |

---

## Parte B — Qué hace FactorIA

### B1. Datos e integraciones

1. Revisamos las respuestas de la Parte A y levantamos el tenant (`config/tenants/<id>.json`).
2. Tú das acceso a tus sistemas (§4). Cada integración se convierte en una *tool*: el
   agente solo consulta lo que declaraste, con el contrato de datos que definimos.
3. Verificamos con un modo de solo lectura que cada tool devuelve datos reales. Ninguna
   tool se activa contra datos de producción sin que lo revises.

### B2. Agente

4. Configuramos el prompt, el saludo, la voz y el idioma.
5. Provisionamos el agente en la plataforma. Los cambios de configuración se aplican
   siempre desde aquí, no desde el panel del proveedor.

### B3. Canal web

6. Habilitamos el widget para tu dominio (es una lista blanca: solo tu web puede
   cargarlo) y te damos el `<script>` de §6.
7. Tú pegas el script y habilitas lo que indica esa misma sección.

### B4. Canal WhatsApp

8. Tú creas la cuenta de Meta Business, la WABA y el número, y autorizas a FactorIA a
   conectar esa cuenta. Ese alta sí es manual y la tienes que hacer tú, porque Meta
   exige entrar en tu cuenta de negocio y poner el método de pago.
9. **Nosotros conectamos esa cuenta al agente**, en cuanto la hayas autorizado. No
   depende de ti: el enlace lo hacemos nosotros desde dentro de FactorIA, es el mismo
   paso para todos los clientes y no tienes que entrar en ningún panel nuestro.
10. Tú apruebas las plantillas en el gestor de WhatsApp: Meta no permite enviar
   ninguna que no esté aprobada, así que conviene pedirlas con antelación.
11. Nosotros declaramos el número y las plantillas que puedes usar, en lista blanca.

### B5. Canal telefónico

12. Compramos el número en nuestro proveedor de telefonía, lo importamos y **nosotros lo
    dejamos funcionando en el agente**. Si en §8 nos dices que quieres conservar tu
    número actual, este paso es portarlo en vez de comprar uno, y ahí los plazos los
    marca tu operador, no nosotros. Recomendamos número propio y no portar el actual:
    la portabilidad tiene timescales que no dependen de nosotros, y mientras tanto el
    número viejo sigue sirviendo.
13. Si quieres pasar a un humano, dinos el número o extensión de destino (§8).

### B6. Antes de publicar

14. Aviso de inteligencia artificial y de grabación: se muestra antes de la primera
    interacción en todos los canales. Lo redactamos en marca FactorIA, pero **necesita
    validación jurídica** antes de salir; es un bloqueante de lanzamiento.
15. Pruebas con los usuarios que indiques (§10) y revisión conjunta.
16. Publicamos y acompañamos la supervisión inicial que acordemos.

---

### Componentes (referencia)

1. **Agente IA** — escucha, diálogo con instrucciones y voz. Alojado por FactorIA: no hay despliegues propios.
2. **FactorIA Tool Layer** — endpoints de integración con los sistemas del cliente (ver checklist §4).
3. **Widget Web** — diálogo en la web corporativa (ver §6).
4. **Mensajería (WhatsApp Business)** — canal de mensajería (ver §7).
5. **Telefonía** — canal de voz (ver §8).
6. **Voz del agente** — selección de voz y aviso de grabación (ver §9, §5).