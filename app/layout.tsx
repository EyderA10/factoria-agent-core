import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FactorIA Agent Core",
  description:
    "Núcleo multi-tenant de agentes: Web / WhatsApp / Phone → agente de voz (ElevenLabs) → FactorIA Tool Layer → sistemas del cliente.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}