import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { EMBED_INIT_MESSAGE, EMBED_RESIZE_MESSAGE, embedSecurityHeaders, frameAncestors } from "@/lib/embed";
import { proxy } from "@/proxy";

const TENANT_PATTERN = { allowedOrigins: ["http://localhost:3000"] };
const EMPTY_TENANT = { allowedOrigins: [] };

describe("embed: frame-ancestors sale de allowedOrigins", () => {
  it("sin orígenes declarados nadie puede enmarcarnos", () => {
    expect(frameAncestors(EMPTY_TENANT)).toBe("'none'");
  });

  it("admite los orígenes declarados y el propio preview interno", () => {
    expect(frameAncestors(TENANT_PATTERN)).toBe("'self' http://localhost:3000");
  });

});

describe("embed: cabeceras de seguridad", () => {
  it("habilita el micrófono dentro del iframe", () => {
    // Sin esto el navegador deniega getUserMedia en un iframe de origen cruzado,
    // que es exactamente el caso del embed.
    expect(embedSecurityHeaders(TENANT_PATTERN)["Permissions-Policy"]).toBe("microphone=(self)");
  });

  it("lleva frame-ancestors en el CSP y no usa X-Frame-Options", () => {
    const headers = embedSecurityHeaders(TENANT_PATTERN);
    expect(headers["Content-Security-Policy"]).toBe("frame-ancestors 'self' http://localhost:3000");
    expect(headers["X-Frame-Options"]).toBeUndefined();
  });

});

describe("embed: proxy aplica las cabeceras por tenant", () => {
  it("limita el embed de vitea a los orígenes que vitea declara", () => {
    const response = proxy(new NextRequest("https://core.factoria.ai/embed/vitea"));
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self' http://localhost:3000"
    );
  });

});

describe("embed: el loader no filtra nada del proveedor", () => {
  const source = readFileSync(resolve(process.cwd(), "public/embed.js"), "utf8");

  it("no menciona ElevenLabs ni ningún endpoint de sesión", () => {
    // El widget es del cliente: si el loaderfiltrara el nombre del proveedor o una URL
    // de sesión, se lo estaría entregando a la web del cliente.
    expect(source).not.toMatch(/elevenlabs/i);
    expect(source).not.toMatch(/\/api\/elevenlabs/);
    expect(source).not.toMatch(/signed_?url/i);
  });
});

describe("embed: los dos lados hablan el mismo idioma", () => {
  const loader = readFileSync(resolve(process.cwd(), "public/embed.js"), "utf8");
  const shell = readFileSync(resolve(process.cwd(), "components/factoria-embed-shell.tsx"), "utf8");

  it("comparten los mismos nombres de mensaje", () => {
    // El clásico fallo silencioso: se renombra la constante en un lado y el redimensionado
    // deja de funcionar sin que nada falle.
    expect(loader).toContain(`var RESIZE_MESSAGE = "${EMBED_RESIZE_MESSAGE}"`);
    expect(loader).toContain(`var INIT_MESSAGE = "${EMBED_INIT_MESSAGE}"`);
    // El shell tiene que publicar exactamente esos mismos nombres.
    expect(shell).toContain("EMBED_RESIZE_MESSAGE");
    expect(shell).toContain("EMBED_INIT_MESSAGE");
  });
});