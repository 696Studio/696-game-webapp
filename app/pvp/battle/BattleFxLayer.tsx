'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

type DebugAttack = { attackerId?: string; targetId?: string; nonce?: number };

type Props = {
  events: FxEvent[];
  /** Controlled from page.tsx (FX button). */
  debug?: boolean;
  /** Optional manual fire (for debug panel). */
  debugAttack?: DebugAttack;
};

const RETRY_FRAMES = 30;

function cssEscapeLite(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function getGlobalRecord(key: string): Record<string, HTMLElement | null> | null {
  try {
    const w = window as any;
    const v = w?.[key];
    if (v && typeof v === 'object') return v as Record<string, HTMLElement | null>;
  } catch {}
  return null;
}

function getCardElementByUnitId(unitId: string): HTMLElement | null {
  if (!unitId) return null;

  // 1) Fast path: global ref map from page.tsx
  const map = getGlobalRecord('__bb_unitEls');
  const fromMap = map?.[unitId];
  if (fromMap) return fromMap;

  // 2) DOM query fallback
  const sel = `[data-unit-id="${cssEscapeLite(unitId)}"]`;
  const root = document.querySelector(sel) as HTMLElement | null;
  if (!root) return null;

  // Prefer an inner card element if present
  const card =
    (root.querySelector?.('.bb-card') as HTMLElement | null) ||
    (root.querySelector?.('.bb-card-root') as HTMLElement | null) ||
    (root.querySelector?.('[data-role="card"]') as HTMLElement | null);

  return card || root;
}

async function animateAttackGhost(attackerEl: HTMLElement, targetEl: HTMLElement, debugEnabled: boolean) {
  const aRect = attackerEl.getBoundingClientRect();
  const tRect = targetEl.getBoundingClientRect();

  // Centers
  const ax = aRect.left + aRect.width / 2;
  const ay = aRect.top + aRect.height / 2;
  const tx = tRect.left + tRect.width / 2;
  const ty = tRect.top + tRect.height / 2;

  const dx = tx - ax;
  const dy = ty - ay;

  // Create a "ghost" clone above everything (prevents overflow clipping)
  const ghost = attackerEl.cloneNode(true) as HTMLElement;
  ghost.style.position = 'fixed';
  ghost.style.left = `${aRect.left}px`;
  ghost.style.top = `${aRect.top}px`;
  ghost.style.width = `${aRect.width}px`;
  ghost.style.height = `${aRect.height}px`;
  ghost.style.margin = '0';
  ghost.style.transform = 'translate3d(0,0,0)';
  ghost.style.pointerEvents = 'none';
  ghost.style.zIndex = '2147483647';
  ghost.style.willChange = 'transform, filter, opacity';
  ghost.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.35))';

  if (debugEnabled) {
    ghost.style.outline = '2px solid rgba(0,255,255,0.85)';
    (targetEl.style as any).outline = '2px solid rgba(255,0,255,0.85)';
    window.setTimeout(() => {
      try {
        (targetEl.style as any).outline = '';
      } catch {}
    }, 900);
  }

  document.body.appendChild(ghost);

  // Dim attacker briefly so it reads as movement
  const attackerAnim = attackerEl.animate(
    [
      { filter: 'brightness(1)', opacity: 1 },
      { filter: 'brightness(0.85)', opacity: 0.55 },
      { filter: 'brightness(1)', opacity: 1 },
    ],
    { duration: 380, easing: 'ease-out' }
  );

  // Target "hit" pulse
  const targetAnim = targetEl.animate(
    [
      { filter: 'brightness(1)', transform: 'scale(1)' },
      { filter: 'brightness(1.35)', transform: 'scale(1.03)' },
      { filter: 'brightness(1)', transform: 'scale(1)' },
    ],
    { duration: 260, easing: 'ease-out', delay: 170 }
  );

  // Fly there and back
  const flyOut = ghost.animate(
    [{ transform: 'translate3d(0,0,0)' }, { transform: `translate3d(${dx}px, ${dy}px, 0)` }],
    { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }
  );

  await flyOut.finished.catch(() => {});
  await sleep(40);

  const flyBack = ghost.animate(
    [{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0,0,0)' }],
    { duration: 180, easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)', fill: 'forwards' }
  );

  await flyBack.finished.catch(() => {});
  ghost.remove();

  await Promise.allSettled([attackerAnim.finished, targetAnim.finished]);
}

export default function BattleFxLayer({ events, debug, debugAttack }: Props) {
  const debugEnabled = !!debug;
  const [mounted, setMounted] = useState(false);

  // queue + seen
  const seenIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<FxEvent[]>([]);
  const runningRef = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Merge in manual debug attack (optional)
  const mergedEvents = useMemo(() => {
    const manualNonce = debugAttack?.nonce ?? 0;
    const manualOk = debugEnabled && manualNonce && debugAttack?.attackerId && debugAttack?.targetId;
    if (!manualOk) return events || [];
    const manual: FxEvent = {
      type: 'attack',
      id: `dbg-${manualNonce}`,
      attackerId: String(debugAttack!.attackerId),
      targetId: String(debugAttack!.targetId),
    };
    return [...(events || []), manual];
  }, [events, debugEnabled, debugAttack?.nonce, debugAttack?.attackerId, debugAttack?.targetId]);

  useEffect(() => {
    if (!mounted) return;

    const list = mergedEvents || [];
    for (const e of list) {
      if (!e || e.type !== 'attack') continue;
      if (seenIdsRef.current.has(e.id)) continue;
      seenIdsRef.current.add(e.id);
      queueRef.current.push(e);
    }

    const run = async () => {
      if (runningRef.current) return;
      runningRef.current = true;
      try {
        while (queueRef.current.length > 0) {
          const ev = queueRef.current.shift()!;

          let attackerEl: HTMLElement | null = null;
          let targetEl: HTMLElement | null = null;

          // DOM might not be ready on the exact tick — retry for a few frames.
          for (let i = 0; i < RETRY_FRAMES; i++) {
            attackerEl = getCardElementByUnitId(ev.attackerId);
            targetEl = getCardElementByUnitId(ev.targetId);
            if (attackerEl && targetEl) break;
            await sleep(16);
          }

          if (!attackerEl || !targetEl) {
            continue;
          }

          await animateAttackGhost(attackerEl, targetEl, debugEnabled);
          await sleep(60);
        }
      } finally {
        runningRef.current = false;
      }
    };

    void run();
  }, [mounted, mergedEvents, debugEnabled]);

  // Pure overlay layer (keep positioned container for future particles/svg)
  return (
    <div
      className="bb-fx-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 40,
      }}
    >
      {debugEnabled ? (
        <div
          style={{
            position: 'fixed',
            right: 10,
            bottom: 10,
            zIndex: 2147483647,
            pointerEvents: 'none',
            font: '12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial',
            color: 'rgba(255,255,255,0.92)',
            background: 'rgba(0,0,0,0.55)',
            padding: '8px 10px',
            borderRadius: 10,
            backdropFilter: 'blur(6px)',
            maxWidth: '70vw',
            whiteSpace: 'pre-wrap',
          }}
        >
          {`FX DEBUG\nfxEvents: ${events?.length ?? 0}\nseen: ${seenIdsRef.current.size}\n`}
        </div>
      ) : null}
    </div>
  );
}
