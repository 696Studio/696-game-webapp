'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const OUT_MS = 360;
const BACK_MS = 180;
const RETRY_FRAMES = 30;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
function computeTouchDelta(attacker: DOMRect, target: DOMRect) {
  const ac = rectCenter(attacker);
  const tc = rectCenter(target);
  const dx = tc.x - ac.x;
  const dy = tc.y - ac.y;

  const maxMove = Math.max(attacker.width, attacker.height) * 1.12;
  const len = Math.hypot(dx, dy) || 1;
  const k = clamp(maxMove / len, 0.55, 0.92);
  return { dx: dx * k, dy: dy * k };
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

function getSlotByUnitId(unitId: string): HTMLElement | null {
  const sel = `[data-unit-id="${safeEscape(String(unitId))}"]`;
  const list = Array.from(document.querySelectorAll<HTMLElement>(sel));
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }
  return null;
}

function getMotionLayer(slot: HTMLElement): HTMLElement | null {
  return (
    slot.querySelector<HTMLElement>('.bb-motion-layer[data-fx-motion="1"]') ||
    slot.querySelector<HTMLElement>('.bb-motion-layer')
  );
}

function getCard(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>('.bb-card');
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const [mounted, setMounted] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  const debug = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const [hud, setHud] = useState('');
  const [cnt, setCnt] = useState(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!events) return;

    if (debug) setCnt(events.length);

    const rafs: number[] = [];
    const timers: number[] = [];

    const runOnce = (e: FxEvent) => {
      const aSlot = getSlotByUnitId(e.attackerId);
      const tSlot = getSlotByUnitId(e.targetId);
      if (!aSlot || !tSlot) return false;

      const aMotion = getMotionLayer(aSlot);
      const tCard = getCard(tSlot);
      if (!aMotion || !tCard) return false;

      const ar = aMotion.getBoundingClientRect();
      const tr = tCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      // Bring above siblings without moving layout
      const prevZ = aMotion.style.zIndex || '';
      aMotion.style.zIndex = '60';
      aMotion.style.willChange = 'transform';

      const prevTgtZ = tCard.style.zIndex || '';
      tCard.style.zIndex = '55';
      tCard.classList.add('is-attack-target');

      // Kill any lingering inline transform that could override animations
      aMotion.style.transform = 'translate3d(0px,0px,0px)';

      // Prefer WAAPI (most reliable, doesn't depend on your CSS being loaded)
      const canWAAPI = typeof (aMotion as any).animate === 'function';
      if (canWAAPI) {
        try {
          const anim = (aMotion as any).animate(
            [
              { transform: 'translate3d(0px,0px,0px)' },
              { transform: `translate3d(${dx}px, ${dy}px, 0px)` },
              { transform: 'translate3d(0px,0px,0px)' },
            ],
            {
              duration: OUT_MS + BACK_MS,
              easing: 'cubic-bezier(.18,.9,.22,1)',
              fill: 'none',
            }
          );
          anim.onfinish = () => {
            try {
              aMotion.style.zIndex = prevZ;
              aMotion.style.willChange = '';
              aMotion.style.transform = '';
            } catch {}
            try {
              tCard.classList.remove('is-attack-target');
              tCard.style.zIndex = prevTgtZ;
            } catch {}
          };
        } catch {
          // fall back below
        }
      } else {
        // Fallback: transition
        aMotion.style.transition = 'none';
        aMotion.style.transform = 'translate3d(0px,0px,0px)';
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        aMotion.offsetHeight;

        aMotion.style.transition = `transform ${OUT_MS}ms cubic-bezier(.18,.9,.22,1)`;
        aMotion.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;

        timers.push(
          window.setTimeout(() => {
            aMotion.style.transition = `transform ${BACK_MS}ms cubic-bezier(.2,.8,.2,1)`;
            aMotion.style.transform = 'translate3d(0px,0px,0px)';

            timers.push(
              window.setTimeout(() => {
                try {
                  aMotion.style.transition = '';
                  aMotion.style.transform = '';
                  aMotion.style.zIndex = prevZ;
                  aMotion.style.willChange = '';
                } catch {}
                try {
                  tCard.classList.remove('is-attack-target');
                  tCard.style.zIndex = prevTgtZ;
                } catch {}
              }, BACK_MS + 40)
            );
          }, OUT_MS + 10)
        );
      }

      if (debug) {
        setHud(
          `OK WAAPI=${canWAAPI ? '1' : '0'}\natt=${e.attackerId} tgt=${e.targetId}\ndx=${Math.round(dx)} dy=${Math.round(dy)}`
        );
        timers.push(window.setTimeout(() => setHud(''), 900));
      }

      // Clear target feedback
      timers.push(
        window.setTimeout(() => {
          try {
            tCard.classList.remove('is-attack-target');
            tCard.style.zIndex = prevTgtZ;
          } catch {}
        }, OUT_MS + BACK_MS + 40)
      );

      return true;
    };

    const runWithRetry = (e: FxEvent) => {
      let tries = 0;
      const tick = () => {
        tries += 1;
        const ok = runOnce(e);
        if (ok) return;
        if (tries < RETRY_FRAMES) rafs.push(requestAnimationFrame(tick));
        else if (debug) {
          setHud(`FAILED\natt=${e.attackerId}\ntgt=${e.targetId}`);
          timers.push(window.setTimeout(() => setHud(''), 1100));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events) {
      if (!e || e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      timers.push(window.setTimeout(() => seen.current.delete(e.id), 4000));
      runWithRetry(e);
    }

    return () => {
      for (const r of rafs) {
        try {
          cancelAnimationFrame(r);
        } catch {}
      }
      for (const t of timers) {
        try {
          clearTimeout(t);
        } catch {}
      }
    };
  }, [mounted, events, debug]);

  if (!mounted) return null;

  if (!debug) return null;

  return (
    <>
      <style>{`
        .bb-fx-debug-hud{
          position:fixed; right:10px; bottom:10px;
          z-index:10000; pointer-events:none;
          font:12px/1.2 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;
          color:rgba(255,255,255,.92);
          background:rgba(0,0,0,.55);
          padding:8px 10px; border-radius:10px;
          backdrop-filter: blur(6px);
          max-width:70vw; white-space:pre-wrap;
        }
        /* tiny target feedback if your CSS doesn't include it */
        .bb-card.is-attack-target{ filter: brightness(1.08); }
      `}</style>
      <div className="bb-fx-debug-hud">{`fxEvents: ${cnt}\n${hud}`}</div>
    </>
  );
}
