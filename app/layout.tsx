import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { GameSessionProvider } from "./context/GameSessionContext";
import BottomNav from "./components/BottomNav";
// если у тебя уже есть i18n-провайдер и будем переводить всё на русский — подключим позже:
// import { I18nProvider } from "./i18n/I18nProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "696 Game",
  description: "Telegram Mini App",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          "antialiased",
          "min-h-dvh",
          "overflow-x-hidden",
        ].join(" ")}
        style={{ isolation: "isolate" }}
      >
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />

        <GameSessionProvider>
          {children}
          <BottomNav />
        </GameSessionProvider>
      </body>
    </html>
  );
}
