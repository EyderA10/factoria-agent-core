import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { EMBED_INIT_MESSAGE, EMBED_RESIZE_MESSAGE } from "@/lib/embed";

const LOADER = readFileSync(resolve(process.cwd(), "public/embed.js"), "utf8");

/**
 * `public/embed.js` es un IIFE de vanilla JS que solo depende de `window` y
 * `document`. Aquí se le da un DOM mínimo para poder ejercitar su lógica (validación
 * del tenant, filtro del `postMessage`, recorte de tamaño) sin meter un navegador
 * completo ni dependencias nuevas.
 */

/**
 * Reproduce una parte del CSSOM que importa: asignar `cssText` rellena las
 * propiedades individuales. Sin esto, `style.width` se quedaría `undefined` y los
 * tests pasarían sin comprobar nada.
 */
class FakeStyle {
  [key: string]: string | undefined;

  set cssText(value: string) {
    for (const property of value.split(";")) {
      const [name, val] = property.split(":").map((part) => part.trim());
      if (name && val) this[name] = val;
    }
  }

  get cssText(): string {
    return Object.entries(this)
      .filter(([, value]) => typeof value === "string")
      .map(([name, value]) => `${name}:${value}`)
      .join(";");
  }
}

class FakeElement {
  attributes: Record<string, string> = {};
  style = new FakeStyle();
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;

  // Los que consulta el loader y que aquí solo existen para poder inyectarlos.
  currentScript: FakeElement | null = null;
  readyState = "complete";
  body: FakeElement | null = null;
  createElement: () => FakeElement = () => new FakeElement();
  querySelectorAll: () => FakeElement[] = () => [];
  contentWindow: { postMessage: (msg: unknown, target: string) => void } = {
    postMessage: vi.fn(),
  };
  /** El loader asigna el `src` como propiedad, no como atributo. */
  src = "";

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  addEventListener(type: string, handler: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(handler);
  }
  appendChild(child: FakeElement) {
    child.parentNode = this;
    this.children.push(child);
  }
  insertBefore(child: FakeElement, _ref: unknown) {
    child.parentNode = this;
    this.children.push(child);
  }
  emit(type: string, event: unknown) {
    for (const handler of this.listeners[type] ?? []) handler(event);
  }
}

function runLoader(options: { tenant?: string | null; pageUrl?: string; innerWidth?: number; innerHeight?: number } = {}) {
  const doc = new FakeElement();
  const script = new FakeElement();
  const pageUrl = options.pageUrl ?? "https://web-del-cliente.com/pagina";

  if (options.tenant !== null) {
    script.setAttribute("data-tenant", options.tenant ?? "vitea");
  }
  script.setAttribute("src", "https://core.example/embed.js");
  doc.currentScript = script;
  doc.readyState = "complete";
  doc.querySelectorAll = () => [];
  doc.body = doc;
  doc.createElement = () => new FakeElement();

  const windowListeners: Record<string, ((event: unknown) => void)[]> = {};
  const win = {
    location: { href: pageUrl, origin: new URL(pageUrl).origin, search: new URL(pageUrl).search },
    innerWidth: options.innerWidth ?? 1280,
    innerHeight: options.innerHeight ?? 900,
    console: { warn: vi.fn() },
    addEventListener(type: string, handler: (event: unknown) => void) {
      (windowListeners[type] ??= []).push(handler);
    },
  };

  const context = {
    window: { ...win, parent: undefined },
    document: doc,
    URL,
    console: win.console,
    isFinite,
    decodeURIComponent,
    encodeURIComponent,
    RegExp,
  };
  runInNewContext(LOADER, context);

  const iframe = doc.body.children[0] as FakeElement | undefined;
  return {
    iframe,
    warn: win.console.warn,
    /** Entrega un mensaje al loader como si fuera el iframe hablando. */
    post(origin: string, data: unknown) {
      for (const handler of windowListeners.message ?? []) handler({ origin, data });
    },
    /** Lanza un `message` como si fuera otro script de la página hablando. */
    postFromPage(origin: string, data: unknown) {
      for (const handler of windowListeners.message ?? []) handler({ origin, data, source: window });
    },
    fireWindow(type: string, event: unknown) {
      for (const handler of windowListeners[type] ?? []) handler(event);
    },
  };
}

describe("embed.js: monta el iframe", () => {
  it("apunta al origen del propio script, no al de la web del cliente", () => {
    const { iframe } = runLoader();
    expect(iframe?.src).toBe("https://core.example/embed/vitea");
  });

  it("nace con un tamaño por defecto antes de que el iframe hable", () => {
    const { iframe } = runLoader();
    expect(iframe?.style.width).toBe("352px");
    expect(iframe?.style.height).toBe("72px");
  });



  it("descarta un tenant manipulado que intenta salirse de /embed/<tenant>", () => {
    // Sin el filtro, `../../api/elevenlabs/session` se metería en el `src`.
    for (const bad of ["../../api/elevenlabs/session", "vitea/../mesa", "Vitea!", "a".repeat(41)]) {
      const { iframe, warn } = runLoader({ tenant: bad });
      expect(iframe, `tenant ${JSON.stringify(bad)}`).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    }
  });

});

describe("embed.js: solo escucha a su propio iframe", () => {
  it("arena el iframe: sin navegación de primer nivel ni popups", () => {
    // El widget vive dentro de la web de un tercero. Que no pueda navegar esa web ni
    // abrir ventanas es gratis: no lo necesita para nada.
    const { iframe } = runLoader();
    const sandbox = iframe?.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).toContain("allow-microphone");
    expect(sandbox).not.toContain("allow-top-navigation");
    expect(sandbox).not.toContain("allow-popups");
  });

  it("acepta el tamaño del iframe de nuestro origen", () => {
    const { iframe, post } = runLoader();
    post("https://core.example", { type: EMBED_RESIZE_MESSAGE, width: 352, height: 632 });
    expect(iframe?.style.height).toBe("632px");
  });

  it("ignora tamaños que vengan de otro origen", () => {
    const { iframe, post } = runLoader();
    post("https://sitio-malicioso.com", { type: EMBED_RESIZE_MESSAGE, width: 9999, height: 9999 });
    expect(iframe?.style.height).toBe("72px");
  });


  it("recorta al viewport para que un tamaño erroneous no tape la web", () => {
    const { iframe, post } = runLoader({ innerWidth: 400, innerHeight: 700 });
    post("https://core.example", { type: EMBED_RESIZE_MESSAGE, width: 5000, height: 5000 });
    expect(iframe?.style.width).toBe("384px");
    expect(iframe?.style.height).toBe("684px");
  });
});

describe("embed.js: handshake con el iframe", () => {
  it("se presenta al cargar el iframe, con su propio origen", () => {
    const { iframe } = runLoader();
    iframe?.emit("load", {});
    expect(iframe?.contentWindow.postMessage).toHaveBeenCalledWith(
      { type: EMBED_INIT_MESSAGE, origin: "https://web-del-cliente.com" },
      "https://core.example"
    );
  });

});