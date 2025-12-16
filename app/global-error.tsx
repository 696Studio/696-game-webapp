"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GLOBAL ERROR]", error);
  }, [error]);

  return (
    <html>
      <body>
        <main className="min-h-screen flex items-center justify-center px-4 pb-24">
          <div className="w-full max-w-md ui-card p-5">
            <div className="text-lg font-semibold">Фатальная ошибка</div>
            <div className="mt-2 text-sm ui-subtle">
              Это глобальная ошибка приложения (не только /pvp).
            </div>

            <pre className="mt-4 text-[11px] whitespace-pre-wrap break-words opacity-90">
{String(error?.message || error)}
            </pre>

            {error?.digest && (
              <div className="mt-2 text-[11px] ui-subtle">digest: {error.digest}</div>
            )}

            <button onClick={reset} className="mt-5 ui-btn ui-btn-primary w-full">
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
