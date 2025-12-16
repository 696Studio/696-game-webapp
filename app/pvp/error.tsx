"use client";

import { useEffect } from "react";

export default function PvpError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/pvp error]", error);
  }, [error]);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 pb-24">
      <div className="w-full max-w-md ui-card p-5">
        <div className="text-lg font-semibold">Краш на /pvp</div>
        <div className="mt-2 text-sm ui-subtle">
          Ниже текст ошибки (это то, что нам нужно, чтобы фиксить точно).
        </div>

        <pre className="mt-4 text-[11px] whitespace-pre-wrap break-words opacity-90">
{String(error?.message || error)}
        </pre>

        {error?.digest && (
          <div className="mt-2 text-[11px] ui-subtle">digest: {error.digest}</div>
        )}

        <button onClick={reset} className="mt-5 ui-btn ui-btn-primary w-full">
          Reload / Retry
        </button>
      </div>
    </main>
  );
}
