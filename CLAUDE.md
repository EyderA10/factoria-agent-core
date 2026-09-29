# CLAUDE.md

Las instrucciones de este repositorio viven en **[`AGENTS.md`](./AGENTS.md)**: stack,
comandos, invariantes de seguridad multi-tenant, flujo de alta de clientes y trampas
conocidas.

Léelo antes de tocar código y respétalo: varios de esos invariantes (resolución del
tenant por hash del secret, saludo del agente vs. del widget, timestamp del webhook)
son contrato, no estilo.
