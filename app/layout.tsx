import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { GameSessionProvider } from "./context/GameSessionContext";
import BottomNav from "./components/BottomNav";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
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
