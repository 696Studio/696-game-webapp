'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_DURATION = 520;
const RETRY_FRAMES = 18;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function computeTouchDelta(a: DOMRect, b: DOMRect) {
  const ac = rectCenter(a);
  const bc = rectCenter(b);
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;

  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

function safeEscape(v: string) {
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function'
      ? cssAny.escape(v)
      : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

/**
 * IMPORTANT:
 * In your DOM there are TWO nodes with the same data-unit-id:
 *   - .bb-slot (outer)
 *   - .bb-card (inner)
 * querySelector() can return the wrong one. We must pick the slot.
 */
function getBestUnitRootById(unitId: string) {
  const list = Array.from(document.querySelectorAll<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`));
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }

  // fallback: something that contains motion-layer
  const hasMotion = list.find((el) => !!el.querySelector('.bb-motion-layer'));
  if (hasMotion) return hasMotion;

  return list[0];
}

function findMotionLayer(slotOrRoot: HTMLElement) {
  const slot = slotOrRoot.classList.contains('bb-slot') ? slotOrRoot : (slotOrRoot.closest('.bb-slot') as HTMLElement | null);
  if (slot) {
    const ml = slot.querySelector<HTMLElement>('.bb-motion-layer');
    if (ml) return ml;
  }
  return slotOrRoot.querySelector<HTMLElement>('.bb-motion-layer');
}

function findCardEl(slotOrRoot: HTMLElement) {
  if (slotOrRoot.classList.contains('bb-card')) return slotOrRoot;
  return slotOrRoot.querySelector<HTMLElement>('.bb-card') || slotOrRoot;
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);

  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const injectedCss = useMemo(
    () => `
/* =========================
   FX injected by BattleFxLayer
   (avoids dependency on external CSS imports)
   ========================= */

@keyframes bb_fx_motion_lunge_to_target {
  0%   { transform: translate3d(0px, 0px, 0) scale(1); }
  55%  { transform: translate3d(var(--atk-dx, 0px), var(--atk-dy, 0px), 0) scale(1.03); }
  70%  { transform: translate3d(calc(var(--atk-dx, 0px) * 0.92), calc(var(--atk-dy, 0px) * 0.92), 0) scale(1.00); }
  100% { transform: translate3d(0px, 0px, 0) scale(1); }
}

@keyframes bb_fx_target_hit {
  0% { transform: translate3d(0,0,0) scale(1); filter: brightness(1); }
  55% { transform: translate3d(0,0,0) scale(0.985); filter: brightness(1.15); }
  100% { transform: translate3d(0,0,0) scale(1); filter: brightness(1); }
}

/* Attack movement: we animate the wrapper that YOU already have in page.tsx */
.bb-motion-layer[data-fx-attacking="1"]{
  animation: bb_fx_motion_lunge_to_target ${ATTACK_DURATION}ms cubic-bezier(.18,.9,.22,1) both !important;
  will-change: transform;
  z-index: 60;
}

/* Target hit: minimal, doesn't move layout */
.bb-card[data-fx-attack-target="1"]{
  animation: bb_fx_target_hit 220ms cubic-bezier(.2,.8,.2,1) both !important;
}

/* Debug helpers */
.bb-fx-debug-outline-attacker { outline: 2px solid rgba(0,255,255,.85) !important; }
.bb-fx-debug-outline-target   { outline: 2px solid rgba(255,0,255,.85) !important; }

.bb-fx-debug-hud {
  position: fixed;
  right: 10px;
  bottom: 10px;
  z-index: 10000;
  pointer-events: none;
  font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: rgba(255,255,255,.92);
  background: rgba(0,0,0,.55);
  padding: 8px 10px;
  border-radius: 10px;
  backdrop-filter: blur(6px);
  max-width: 70vw;
  white-space: pre-wrap;
}
`,
    []
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) setDebugCount((events || []).length);

    const cleanup = (motionEl: HTMLElement | null, targetCard: HTMLElement | null) => {
      try {
        if (motionEl) {
          motionEl.removeAttribute('data-fx-attacking');
          motionEl.style.removeProperty('--atk-dx');
          motionEl.style.removeProperty('--atk-dy');
        }
      } catch {}
      try {
        if (targetCard) targetCard.removeAttribute('data-fx-attack-target');
      } catch {}
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getBestUnitRootById(attackerId);
      const targetRoot = getBestUnitRootById(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const motionEl = findMotionLayer(attackerRoot);
      const attackerCard = findCardEl(attackerRoot);
      const targetCard = findCardEl(targetRoot);

      if (!motionEl) {
        if (debugEnabled) {
          setDebugMsg(`FX: motion-layer NOT FOUND\nattackerId=${attackerId}\nroot=${attackerRoot.className}`);
        }
        return false;
      }

      const ar = attackerCard.getBoundingClientRect();
      const tr = targetCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerCard.classList.add('bb-fx-debug-outline-attacker');
        targetCard.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerCard.classList.remove('bb-fx-debug-outline-attacker');
            targetCard.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      // Trigger via DATA ATTRIBUTES (React won't wipe them)
      motionEl.style.setProperty('--atk-dx', `${dx}px`);
      motionEl.style.setProperty('--atk-dy', `${dy}px`);

      motionEl.removeAttribute('data-fx-attacking');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      motionEl.offsetHeight;
      motionEl.setAttribute('data-fx-attacking', '1');

      targetCard.removeAttribute('data-fx-attack-target');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      targetCard.offsetHeight;
      targetCard.setAttribute('data-fx-attack-target', '1');

      timers.push(window.setTimeout(() => cleanup(motionEl, targetCard), ATTACK_DURATION + 120));

      if (debugEnabled) {
        setDebugMsg(
          `FX: OK\nroot=${attackerRoot.classList.contains('bb-slot') ? 'bb-slot' : attackerRoot.tagName}\nmotion-layer=yes\ndx=${Math.round(
            dx
          )} dy=${Math.round(dy)}`
        );
        timers.push(window.setTimeout(() => setDebugMsg(''), 900));
      }

      return true;
    };

    const runWithRetry = (attackerId: string, targetId: string) => {
      let frame = 0;
      const tick = () => {
        frame += 1;
        const ok = tryOnce(attackerId, targetId);
        if (ok) return;

        if (frame < RETRY_FRAMES) {
          rafs.push(requestAnimationFrame(tick));
        } else if (debugEnabled) {
          setDebugMsg(`FX: failed after retries\nattackerId=${attackerId}\ntargetId=${targetId}`);
          timers.push(window.setTimeout(() => setDebugMsg(''), 1200));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), ATTACK_DURATION + 800));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{injectedCss}</style>
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
