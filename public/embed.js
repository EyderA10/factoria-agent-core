/**
 * Loader del widget embebible de FactorIA.
 *
 * Uso en la web del cliente:
 *
 *   <script
 *     src="https://EMBED_HOST/embed.js"
 *     data-tenant="ID_DEL_TENANT"
 *     defer
 *   ></script>
 *
 * Qué hace y qué no hace, a propósito:
 *
 *   - No pide nada a la API. El widget corre dentro de un iframe servido por
 *     FactorIA, así que la sesión, el branding y el contexto viven en nuestro
 *     origen. Por eso no hace falta CORS ni tokens en la web del cliente.
 *   - Solo crea el iframe y lo dimensiona. El tamaño se lo comunica el propio
 *     iframe con `postMessage`; aquí no hay ni el tenant ni su config.
 *   - Es un único `<iframe>` anclado abajo a la derecha. La burbuja también se
 *     renderiza dentro del iframe, así que el CSS de la web del cliente no puede
 *     deformar el widget.
 *
 * Este fichero se sirve tal cual desde `public/`, sin transpilar: nada de sintaxis
 * moderna para que funcione en navegadores viejos sin necesidad de polyfills.
 */
(function () {
  "use strict";

  var TENANT_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
  var RESIZE_MESSAGE = "factoria-embed:resize";
  var INIT_MESSAGE = "factoria-embed:init";
  var Z_INDEX = "2147483000";

  function warn(message) {
    if (window.console && window.console.warn) {
      window.console.warn("[factoria-embed] " + message);
    }
  }

  function readTenantId(script) {
    var id = script.getAttribute("data-tenant");
    if (!id) {
      var match = /[?&]tenant=([^&#]+)/.exec(window.location.search);
      id = match ? decodeURIComponent(match[1]) : null;
    }
    if (!id) {
      warn('falta data-tenant en el <script>: <script src=".../embed.js" data-tenant="ID"></script>');
      return null;
    }
    id = id.trim().toLowerCase();
    if (!TENANT_PATTERN.test(id)) {
      // Se filtra aquí porque el id acaba en la URL del iframe: sin esto, un
      // `data-tenant` manipulado podría intentar salirse de `/embed/<tenant>`.
      warn('data-tenant inválido: ' + id);
      return null;
    }
    return id;
  }

  /**
   * Origen del propio script. Se usa para validar `postMessage` (misma origen y
   * nada más) y para construir la URL del iframe, de modo que el loader funciona
   * igual en dev, en staging y en producción sin configuración adicional.
   */
  function readOrigin(script) {
    var src = script.getAttribute("src");
    if (!src) return null;
    try {
      return new URL(src, window.location.href).origin;
    } catch (err) {
      warn("no se pudo resolver el origen del script: " + err);
      return null;
    }
  }

  function applySize(frame, width, height) {
    // El loader no confía en el tamaño que le envíen: se acota al viewport para
    // que un cálculo equivocado en el iframe no pueda dejar la web sin usable.
    var maxWidth = Math.max(0, window.innerWidth - 16);
    var maxHeight = Math.max(0, window.innerHeight - 16);
    frame.style.width = Math.min(width, maxWidth) + "px";
    frame.style.height = Math.min(height, maxHeight) + "px";
  }

  function mount(script) {
    if (script.getAttribute("data-factoria-mounted") === "1") return;
    script.setAttribute("data-factoria-mounted", "1");

    var tenantId = readTenantId(script);
    if (!tenantId) return;

    var origin = readOrigin(script);
    if (!origin) return;

    var frame = document.createElement("iframe");
    frame.src = origin + "/embed/" + encodeURIComponent(tenantId);
    frame.title = "Conversación con el asistente";
    frame.loading = "eager";
    frame.allow = "microphone";
    // Sin `allow-top-navigation` ni `allow-popups`: el widget no navega ni abre
    // ventanas, así que no se le concede. `allow-same-origin` hace falta para que
    // el `localStorage` del iframe funcione; `allow-scripts` es lo obvio.
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-microphone");
    frame.style.cssText =
      "position:fixed;right:16px;bottom:16px;border:0;margin:0;" +
      "width:352px;height:72px;max-width:100%;color-scheme:dark;" +
      "background:transparent;z-index:" + Z_INDEX + ";";

    function onMessage(event) {
      // Solo nos fiamos de mensajes de nuestro propio origen y con la forma exacta.
      if (event.origin !== origin) return;
      var data = event.data;
      if (!data || typeof data !== "object" || data.type !== RESIZE_MESSAGE) return;
      if (typeof data.width !== "number" || typeof data.height !== "number") return;
      if (!isFinite(data.width) || !isFinite(data.height)) return;
      applySize(frame, data.width, data.height);
    }

    window.addEventListener("message", onMessage);

    // Handshake: el iframe solo publica su tamaño a partir de que le digamos cuál es
    // nuestro origen. Hace falta porque el `targetOrigin` de `postMessage` es el
    // origen de quien recibe, y quien recibe aquí es la web del cliente.
    frame.addEventListener("load", function () {
      frame.contentWindow.postMessage(
        { type: INIT_MESSAGE, origin: window.location.origin },
        origin
      );
    });

    // Por si el cliente redimensiona la ventana con el widget abierto.
    window.addEventListener("resize", function () {
      applySize(frame, parseInt(frame.style.width, 10) || 352, parseInt(frame.style.height, 10) || 72);
    });

    function attach() {
      if (script.parentNode) script.parentNode.insertBefore(frame, script.nextSibling);
      else document.body.appendChild(frame);
    }

    if (document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);
  }

  function init() {
    var script = document.currentScript;
    // `document.currentScript` es null si el script se cargó async; se recupera el
    // último <script src> de FactorIA como plan B.
    if (!script) {
      var scripts = document.querySelectorAll("script[src]");
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (/embed\.js(\?|$)/.test(scripts[i].getAttribute("src") || "")) {
          script = scripts[i];
          break;
        }
      }
    }
    if (!script) {
      warn("no se encontró el <script> del loader");
      return;
    }
    mount(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();