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
    console.error("[Global error boundary]", error);
  }, [error]);

  return (
    <html>
      <body className="bg-black text-white">
        <main className="min-h-screen flex items-center justify-center px-4">
          <div className="max-w-md w-full border border-red-900/60 bg-red-950/30 rounded-2xl p-5">
            <div className="text-lg font-semibold text-red-200">
              App crashed
            </div>

            <div className="mt-4 p-3 rounded-lg border border-red-900/50 bg-black/40">
              <div className="text-[11px] text-zinc-500 mb-1">MESSAGE</div>
              <div className="text-sm text-red-100 break-words">
                {error?.message || "Unknown error"}
              </div>
              {error?.digest && (
                <div className="mt-2 text-xs text-zinc-300 break-words">
                  Digest: {error.digest}
                </div>
              )}
            </div>

            <button
              onClick={() => reset()}
              className="mt-4 w-full px-4 py-2 rounded-lg border border-zinc-700 text-sm hover:bg-zinc-900"
            >
              Retry
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
