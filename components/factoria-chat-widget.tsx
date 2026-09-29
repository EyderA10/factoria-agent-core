"use client";

import {
  ConversationProvider,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Power, Send } from "lucide-react";

type MessageRole = "user" | "agent";

interface ChatMessage {
  id: number;
  role: MessageRole;
  text: string;
  tentative?: boolean;
}

interface WidgetProps {
  /** Agent ID de ElevenLabs (opcional si el tenant ya está provisionado en DB). */
  agentId?: string;
  /** Tenant (id de config/tenants). El agente se resuelve en DB por tenant. */
  tenantId?: string;
  title?: string;
  /** White-label: color e ícono del cliente. */
  primaryColor?: string;
  icon?: string;
}

const ECHO_WINDOW_MS = 2000;

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function FactorIAChatWidget({
  agentId,
  tenantId,
  title = "FactorIA Agent",
  primaryColor = "#4f46e5",
  icon,
}: WidgetProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const nextIdRef = useRef(1);
  const lastLocalRef = useRef<{ role: MessageRole; text: string; at: number } | null>(null);

  const pushMessage = useCallback((role: MessageRole, text: string, tentative = false) => {
    const id = nextIdRef.current++;
    lastLocalRef.current = { role, text: normalize(text), at: Date.now() };
    setMessages((prev) =>
      tentative
        ? [...prev.filter((m) => !m.tentative), { id, role, text, tentative }]
        : [...prev, { id, role, text }]
    );
  }, []);

  const handleSdkMessage = useCallback(
    (props: { message?: string; role?: string }) => {
      const text = props.message?.trim();
      if (!text) return;

      const role: MessageRole = props.role === "user" ? "user" : "agent";
      const lastLocal = lastLocalRef.current;
      const isEcho =
        lastLocal !== null &&
        lastLocal.role === role &&
        lastLocal.text === normalize(text) &&
        Date.now() - lastLocal.at < ECHO_WINDOW_MS;

      if (isEcho) {
        lastLocalRef.current = null;
        return;
      }
      pushMessage(role, text);
    },
    [pushMessage]
  );

  const handleSdkConnect = useCallback(() => {
    setError(null);
    setSetupNeeded(false);
    setMicMuted(true);
  }, []);

  const handleSdkDisconnect = useCallback(() => {
    setMicMuted(true);
    pushMessage("agent", "Conversación finalizada.");
  }, [pushMessage]);

  const handleSdkError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    setError(message || "Error en la conversación");
  }, []);

  if (setupNeeded) {
    return <SetupPanel title={title} tenantId={tenantId} />;
  }

  return (
    <ConversationProvider
      isMuted={micMuted}
      onMutedChange={setMicMuted}
      onMessage={handleSdkMessage}
      onError={handleSdkError}
      onConnect={handleSdkConnect}
      onDisconnect={handleSdkDisconnect}
    >
      <div className="fixed bottom-5 right-5 z-50 flex w-88 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/95 text-white shadow-2xl backdrop-blur-md">
        <Header title={title} primaryColor={primaryColor} icon={icon} />
        <MessageList messages={messages} error={error} />
        <RealControls
          agentId={agentId}
          tenantId={tenantId}
          primaryColor={primaryColor}
          pushMessage={pushMessage}
          onSetupNeeded={() => setSetupNeeded(true)}
        />
      </div>
    </ConversationProvider>
  );
}

function Header({
  title,
  primaryColor,
  icon,
}: {
  title: string;
  primaryColor: string;
  icon?: string;
}) {
  const { status } = useConversationStatus();
  const { isSpeaking, isListening } = useConversationMode();
  const { isMuted } = useConversationInput();
  const { endSession } = useConversationControls();

  const connected = status === "connected";
  const listening = connected && !isMuted && isListening;
  const speaking = connected && isSpeaking;

  const dotClass =
    status === "connecting"
      ? "bg-amber-400 animate-pulse"
      : connected
        ? speaking
          ? "bg-emerald-400 animate-pulse"
          : listening
            ? "bg-emerald-400 animate-pulse [animation-duration:1.8s]"
            : "bg-emerald-400"
        : "bg-rose-500";

  const statusLabel = statusAnnouncement(status, isMuted, speaking, listening);

  const handleEnd = useCallback(() => {
    endSession();
  }, [endSession]);

  return (
    <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {icon ? (
          <span aria-hidden className="shrink-0">
            {icon}
          </span>
        ) : null}
        <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate text-sm font-semibold tracking-wide text-slate-100">{title}</span>
        <span className="sr-only" aria-live="polite">
          {statusLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
          style={{ background: `${primaryColor}33`, color: primaryColor }}
        >
          Voz + texto
        </span>
        {connected && (
          <button
            type="button"
            onClick={handleEnd}
            aria-label="Finalizar conversación"
            title="Finalizar conversación"
            className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-500/15 text-rose-300 transition hover:bg-rose-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
          >
            <Power size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function statusAnnouncement(
  status: string,
  isMuted: boolean,
  speaking: boolean,
  listening: boolean
): string {
  if (status === "connecting") return "Conectando con el agente.";
  if (status !== "connected") return "Sin conexión con el agente.";
  if (speaking) return "El agente está hablando.";
  if (listening) return "El micrófono está activo. Te escucho.";
  return isMuted
    ? "Conectado en modo texto. Activa el micrófono para hablar."
    : "Conectado. Micrófono activo.";
}

function MessageList({ messages, error }: { messages: ChatMessage[]; error: string | null }) {
  const { status } = useConversationStatus();
  const { isMuted } = useConversationInput();
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = status === "connected";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, error]);

  const emptyText = error
    ? "No se pudo iniciar la conversación."
    : connected
      ? isMuted
        ? "Conexión establecida. Escribe tu consulta o activa el micrófono."
        : "Conexión establecida. Te escucho."
      : "Pulsa «Iniciar conversación» para hablar o escribir.";

  return (
    <div ref={scrollRef} className="flex h-64 flex-col gap-2 overflow-y-auto bg-slate-950 p-3 text-xs">
      {messages.length === 0 && (
        <div className="flex h-full items-center justify-center px-6 text-center italic text-slate-500">
          {emptyText}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`max-w-[85%] rounded-lg px-2.5 py-2 ${msg.role === "agent" ? "bg-slate-800 text-slate-200" : "ml-auto bg-blue-600 text-white"} ${msg.tentative ? "opacity-50" : ""}`}
        >
          <span className="mb-0.5 block text-[9px] font-bold uppercase opacity-60">
            {msg.role === "agent" ? "Agente" : "Tú"}
          </span>
          {msg.text}
        </div>
      ))}
    </div>
  );
}

function RealControls({
  agentId,
  tenantId,
  primaryColor,
  pushMessage,
  onSetupNeeded,
}: {
  agentId?: string;
  tenantId?: string;
  primaryColor: string;
  pushMessage: (role: MessageRole, text: string, tentative?: boolean) => void;
  onSetupNeeded: () => void;
}) {
  const { startSession, sendUserMessage, sendUserActivity } = useConversationControls();
  const { status } = useConversationStatus();
  const { isMuted, setMuted } = useConversationInput();

  const [text, setText] = useState("");
  const [starting, setStarting] = useState(false);

  const connected = status === "connected";
  const busy = starting || status === "connecting";

  const [userId] = useState(() => {
    if (typeof window === "undefined") return "pending";
    const key = "factoria_user_id";
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = `web_${Math.random().toString(36).slice(2, 10)}`;
      window.localStorage.setItem(key, id);
    }
    return id;
  });

  const handleStart = useCallback(async () => {
    setStarting(true);
    try {
      const query = tenantId
        ? `tenant=${encodeURIComponent(tenantId)}`
        : `agentId=${encodeURIComponent(agentId ?? "")}`;
      const res = await fetch(`/api/elevenlabs/session?${query}`);
      const body = (await res.json().catch(() => ({}))) as {
        signedUrl?: string;
        agentId?: string;
        error?: string;
      };

      if (!res.ok) {
        if (body.error === "not_configured") {
          onSetupNeeded();
        }
        throw new Error(body.error ?? "No se pudo obtener la sesión del agente");
      }

      if (body.signedUrl) {
        await startSession({ signedUrl: body.signedUrl, userId });
      } else if (body.agentId) {
        await startSession({ agentId: body.agentId, userId });
      } else {
        throw new Error("La sesión no devolvió agente ni signed URL");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushMessage("agent", `Error al iniciar: ${message}`);
    } finally {
      setStarting(false);
    }
  }, [agentId, tenantId, onSetupNeeded, pushMessage, startSession, userId]);

  const handleSend = useCallback(() => {
    const value = text.trim();
    if (!value || !connected) return;
    pushMessage("user", value);
    sendUserMessage(value);
    setText("");
  }, [connected, pushMessage, sendUserMessage, text]);

  // Mientras el usuario esté inactivo, resetea periódicamente el timeout de
  // turno de ElevenLabs (evento user_activity). Sin esto, el agente retoma el
  // turno tras el silencio y pregunta "¿sigues ahí?" / "¿algo más?". Con este
  // loop, el agente solo responde cuando el usuario envía texto o audio.
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => sendUserActivity(), 10_000);
    return () => clearInterval(interval);
  }, [connected, sendUserActivity]);

  return (
    <div className="flex flex-col gap-2 p-3">
      {!connected && (
        <button
          type="button"
          onClick={handleStart}
          disabled={busy}
          style={{ background: primaryColor }}
          className="rounded-xl py-2.5 text-xs font-semibold text-white shadow transition active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? "Conectando…" : "Iniciar conversación"}
        </button>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!connected}
          placeholder={connected ? "Escribe al agente…" : "Conecta para hablar/escribir"}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-2 text-xs text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => setMuted(!isMuted)}
          disabled={!connected}
          aria-pressed={!isMuted}
          aria-label={isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          title={isMuted ? "Activar micrófono" : "Silenciar micrófono"}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition focus:outline-none focus-visible:ring-2 disabled:opacity-40 ${
            isMuted
              ? "bg-slate-800 text-slate-400 hover:bg-slate-700"
              : "bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30"
          } focus-visible:ring-emerald-400`}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          type="submit"
          disabled={!connected || !text.trim()}
          aria-label="Enviar mensaje"
          title="Enviar mensaje"
          style={connected && text.trim() ? { background: primaryColor } : undefined}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-white transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>

      {connected && isMuted && (
        <p className="text-[10px] text-slate-500">Toca el micrófono para hablar.</p>
      )}
    </div>
  );
}

function SetupPanel({ title, tenantId }: { title: string; tenantId?: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex w-88 max-w-[calc(100vw-2.5rem)] flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/95 p-4 text-white shadow-2xl backdrop-blur-md">
      <div className="text-sm font-semibold text-slate-100">{title} — sin configurar</div>
      <ol className="list-decimal space-y-1.5 pl-5 text-xs text-slate-300">
        <li>Obtén tu API key del proveedor de voz: Dashboard → API Keys.</li>
        <li>
          Crea el config del tenant en <code className="font-mono text-emerald-400">config/tenants/</code> (o con{" "}
          <code className="font-mono text-emerald-400">npm run setup:new</code>).
        </li>
        <li>
          Provisiona secret + tools + agente:{" "}
          <code className="font-mono text-emerald-400">
            npm run setup -- --tenant {tenantId ?? "<id>"}
          </code>
        </li>
        <li>
          Guarda el secret generado en <code className="font-mono text-emerald-400">.env</code> (o Vercel) y reinicia el
          server.
        </li>
      </ol>
    </div>
  );
}
