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
  debug?: boolean;
  debugAttack?: DebugAttack;
};

function cssEscapeLite(v: string): string {
  // Minimal escape for attribute selectors (good enough for UUID-ish ids)
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function getCardElementByUnitId(unitId: string): HTMLElement | null {
  if (!unitId) return null;
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

async function animateAttackGhost(attackerEl: HTMLElement, targetEl: HTMLElement) {
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
  // Slightly lift it visually
  ghost.style.filter = 'drop-shadow(0 10px 18px rgba(0,0,0,0.35))';

  document.body.appendChild(ghost);

  // Dim attacker briefly so it reads as movement
  const attackerAnim = attackerEl.animate(
    [{ filter: 'brightness(1)', opacity: 1 }, { filter: 'brightness(0.85)', opacity: 0.55 }, { filter: 'brightness(1)', opacity: 1 }],
    { duration: 380, easing: 'ease-out' }
  );

  // Target "hit" pulse
  const targetAnim = targetEl.animate(
    [{ filter: 'brightness(1)', transform: 'scale(1)' }, { filter: 'brightness(1.35)', transform: 'scale(1.03)' }, { filter: 'brightness(1)', transform: 'scale(1)' }],
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

  // Ensure they finish (best effort)
  await Promise.allSettled([attackerAnim.finished, targetAnim.finished]);
}

export default function BattleFxLayer({ events, debug, debugAttack }: Props) {
  const debugEnabled = !!debug;

  const [mounted, setMounted] = useState(false);

  // queue + seen
  const seenIdsRef = useRef<Set<string>>(new Set());
  const queueRef = useRef<FxEvent[]>([]);
  const runningRef = useRef(false);

  // Mount guard for Next
  useEffect(() => {
    setMounted(true);
  }, []);

  // Merge in manual debug attack (Fire button)
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

  // Pump queue
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
          const attackerEl = getCardElementByUnitId(ev.attackerId);
          const targetEl = getCardElementByUnitId(ev.targetId);

          if (!attackerEl || !targetEl) {
            // If DOM isn't ready yet, retry a little later once
            await sleep(60);
            const a2 = getCardElementByUnitId(ev.attackerId);
            const t2 = getCardElementByUnitId(ev.targetId);
            if (!a2 || !t2) continue;
            await animateAttackGhost(a2, t2);
          } else {
            await animateAttackGhost(attackerEl, targetEl);
          }

          // small gap between attacks
          await sleep(60);
        }
      } finally {
        runningRef.current = false;
      }
    };

    run();
  }, [mounted, mergedEvents]);

  // Pure overlay layer (we don't render anything heavy here)
  // Keep it as a positioned container in case you later add particles/svg.
  return (
    <div
      className="bb-fx-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 40,
      }}
    />
  );
}
