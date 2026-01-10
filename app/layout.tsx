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
        {/* TG WebApp */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />

        {/* Detect iOS Telegram WebView -> add class */}
        <Script id="tg-ios-detect" strategy="beforeInteractive">
          {`
(function () {
  try {
    var ua = navigator.userAgent || "";
    var isIOS = /iPad|iPhone|iPod/.test(ua);
    // Telegram iOS webview also has "Telegram" in UA most of the time
    if (isIOS) document.documentElement.classList.add("tg-ios");
  } catch (e) {}
})();
          `}
        </Script>

              {/* BUILD STAMP (remove later) */}
      <div
        className="bb-build-stamp"
        style={{
          position: "fixed",
          left: 10,
          top: 10,
          zIndex: 999999,
          background: "rgba(255,0,0,0.78)",
          color: "#fff",
          font: "12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial",
          padding: "6px 10px",
          borderRadius: 10,
          pointerEvents: "none",
        }}
      >
        BUILD_STAMP_ROOT_v1
      </div>

      <GameSessionProvider>
          {children}
          <BottomNav />
        </GameSessionProvider>
      </body>
    </html>
  );
}
