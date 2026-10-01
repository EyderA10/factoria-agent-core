# Checklist de Onboarding — FactorIA Agent Platform

> Entregable para el cliente. Rellénalo y devuélvelo a FactorIA; luego lo aplicamos al agente.
> Contacto: [email / teléfono de FactorIA]

---

## 1. Datos de la empresa

| Campo | Respuesta |
|---|---|
| Razón social / marca | |
| Persona de contacto | |
| Email de contacto | |
| Teléfono de contacto | |
| Rubro / descripción breve | |
| Canales que quiere habilitar (Web · WhatsApp · Teléfono) | |

## 2. Qué debe hacer el agente

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

## 3. Negocio y horarios

| Pregunta | Respuesta |
|---|---|
| Idioma(s) de atención | |
| Horario de atención (días y horas) | |
| Zona horaria (ej. América/Bogotá) | |
| ¿Disponibilidad en tiempo real u horarios estáticos? | |
| ¿Precios? ¿Se cobra o solo se informa? | |

## 4. Fuentes de datos para la integración (Tools)

| Fuente | Tipo (API / base de datos / hoja) | URL / servidor | Cómo autenticarse | Persona a cargo |
|---|---|---|---|---|
| Disponibilidad | | | | |
| Catálogo / precios | | | | |
| Agenda / reservas | | | | |
| CRM / clientes | | | | |
| Búsqueda de asesor humano | | | | |

## 5. Clientes y datos personales

| Pregunta | Respuesta |
|---|---|
| ¿Qué datos del cliente se recogen en las llamadas? | |
| ¿Se autoriza grabación y transcripción? (requisito legal) | |
| ¿Tienen Política de Tratamiento de Datos / encaje RGPD? | |
| ¿Se deben anonimizar datos antes de usar herramientas de IA? | |
| Persona responsable de datos (DPO/encargado) | |

## 6. Web (widget)

| Pregunta | Respuesta |
|---|---|
| URL(s) del sitio donde irá el widget | |
| ¿Widget propio de FactorIA o el widget estándar de la plataforma? | |
| Apariencia (colores / logo / posición) | |

## 7. WhatsApp

| Pregunta | Respuesta |
|---|---|
| ¿Tienen un número de WhatsApp Business activo? | ☐ Sí ☐ No |
| Número de WhatsApp Business | |
| ¿Otro número disponible (sin WhatsApp) por si se requiere reconectar? | |
| Plantillas aprobadas para mensajes proactivos (promociones, recordatorios) | |

## 8. Telefonía (opcional)

| Pregunta | Respuesta |
|---|---|
| ¿Número(s) actual(es)? | |
| ¿Proveedor telefónico actual? | |
| ¿Buscan portabilidad / número nuevo? | |
| ¿Llamadas entrantes, salientes o ambas? | |
| ¿Transferencia a humano en una extensión / número interno? | |

## 9. Voz y estilo del agente

| Pregunta | Respuesta |
|---|---|
| Nombre del agente (ej. «Aura») | |
| Personalidad / tono (formal, cercano…) | |
| Voz preferida (género, estilo) | |
| Primer mensaje de saludo | |

## 10. Pruebas y lanzamiento

| Pregunta | Respuesta |
|---|---|
| Usuarios de prueba (email / WhatsApp / teléfono) | |
| Fecha objetivo de lanzamiento | |
| ¿Plan de entrenamiento de los agentes humanos? | |
| Nivel de supervisión inicial (escucha de llamadas) | |

---

### Componentes (referencia)

1. **Agente IA** — escucha, diálogo con instrucciones y voz. Alojado por FactorIA: no hay despliegues propios.
2. **FactorIA Tool Layer** — endpoints de integración con los sistemas del cliente (ver checklist §4).
3. **Widget Web** — diálogo en la web corporativa (ver §6).
4. **Mensajería (WhatsApp Business)** — canal de mensajería (ver §7).
5. **Telefonía** — canal de voz (ver §8).
6. **Voz del agente** — selección de voz y aviso de grabación (ver §9, §5).