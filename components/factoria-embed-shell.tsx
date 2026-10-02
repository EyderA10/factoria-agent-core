"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FactorIAChatWidget } from "@/components/factoria-chat-widget";
import { EMBED_DEFAULT_WIDTH, EMBED_INIT_MESSAGE, EMBED_RESIZE_MESSAGE } from "@/lib/embed";

interface EmbedShellProps {
  tenantId: string;
  title: string;
  primaryColor: string;
  icon: string;
}

/**
 * Contenido de `/embed/<tenant>`: burbuja + panel, y nada más.
 *
 * Se ejecuta dentro del iframe que crea `public/embed.js`, o sea en nuestro propio
 * origen. Por eso el `fetch` de la sesión es same-origin y no hace falta CORS.
 *
 * El shell no sabe nada del sitio del cliente: solo publica su tamaño con
 * `postMessage` y deja que el loader redimensione el iframe. Es el único canal entre
 * los dos lados, así que el CSS de la web del cliente no puede alcanzar al widget.
 */
export function FactorIAEmbedShell({ tenantId, title, primaryColor, icon }: EmbedShellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Origen de la web que nos ha embebido. Lo anuncia el loader en el handshake.
   *
   * `postMessage` exige como `targetOrigin` el origen de quien recibe, que aquí es
   * el cliente y no nosotros. Con `"*"` el mensaje llegaría igualmente (el payload
   * son dos enteros), pero aquí se evita: se publica a un origen concreto, el que
   * el propio loader declara, y si no se sabe ninguno no se publica nada. El loader
   * ya nace con un tamaño por defecto, así que fallar en silencio es seguro.
   */
  const [parentOrigin, setParentOrigin] = useState<string | null>(null);

  useEffect(() => {
    const onInit = (event: MessageEvent) => {
      // Solo cuenta si viene del frame padre real y trae un origen usable.
      if (event.source !== window.parent) return;
      const announced = (event.data as { origin?: unknown } | null)?.origin;
      if (typeof announced !== "string" || announced === "" || announced === "null") return;
      setParentOrigin(announced);
    };

    window.addEventListener("message", onInit);
    // Respaldo: si el handshake no llega (scripts con orden raro, proxies que
    // limpian headers), el referrer suele seguir diciendo cuál es el sitio.
    if (!parentOrigin && document.referrer) {
      try {
        setParentOrigin(new URL(document.referrer).origin);
      } catch {
        // referrer no parseable: nos quedamos sin destino, que es el caso seguro.
      }
    }

    return () => window.removeEventListener("message", onInit);
    // Solo en el montaje: `parentOrigin` se lee aquí de forma intencionada para no
    // re-registrar el listener en cada handshake.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El tamaño se mide del DOM, no se calcula. Si el panel crece (mensajes, error,
  // pantalla corta) el loader se entera sin que haya una aritmética replicada en
  // dos sitios que pueda desincronizarse.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || !parentOrigin) return;

    const publish = () => {
      const box = node.getBoundingClientRect();
      window.parent.postMessage(
        { type: EMBED_RESIZE_MESSAGE, width: Math.ceil(box.width), height: Math.ceil(box.height) },
        parentOrigin
      );
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, parentOrigin]);

  // Escape cierra el panel. Sin esto, dentro de la web del cliente no hay forma de
  // salir del overlay con teclado.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  return (
    <div
      ref={containerRef}
      style={{ width: EMBED_DEFAULT_WIDTH }}
      className="flex flex-col items-end gap-4"
    >
      {open && (
        <div style={{ height: "min(560px, 72vh)" }} className="w-full shrink-0">
          <FactorIAChatWidget
            tenantId={tenantId}
            title={title}
            primaryColor={primaryColor}
            icon={icon}
            layout="embed"
          />
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Cerrar la conversación" : "Abrir la conversación"}
        aria-expanded={open}
        style={{ width: 56, height: 56, backgroundColor: primaryColor }}
        className="flex shrink-0 cursor-pointer items-center justify-center rounded-full text-2xl text-white shadow-xl ring-1 ring-white/20 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <span aria-hidden>{open ? "×" : icon}</span>
      </button>
    </div>
  );
}