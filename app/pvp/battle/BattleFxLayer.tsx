'use client';

import React, { useEffect, useMemo, useRef } from 'react';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const DURATION_MS = 360;
const RETURN_MS = 220;
const RETRY_FRAMES = 28;

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function rectCenter(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Move attacker towards target, but not full center-to-center:
 * - scale down delta to "touch" feeling
 * - clamp max travel so it never flies too far
 */
function computeTouchDelta(attackerRect: DOMRect, targetRect: DOMRect) {
  const ac = rectCenter(attackerRect);
  const tc = rectCenter(targetRect);

  const rawDx = tc.x - ac.x;
  const rawDy = tc.y - ac.y;

  const len = Math.hypot(rawDx, rawDy) || 1;
  const maxMove = Math.max(attackerRect.width, attackerRect.height) * 1.15;

  // base touch factor (keeps it from full overlap)
  const baseK = 0.9;

  // clamp so far targets don't yeet the card
  const k = clamp((maxMove / len) * baseK, 0.55, 0.92);

  return { dx: rawDx * k, dy: rawDy * k };
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
 * IMPORTANT: there are multiple nodes with the same data-unit-id.
 * We prefer the outer slot (.bb-slot) because it contains .bb-motion-layer.
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
  return slotOrRoot.querySelector<HTMLElement>('.bb-motion-layer') || null;
}

function findCard(slotOrRoot: HTMLElement) {
  if (slotOrRoot.classList.contains('bb-card')) return slotOrRoot;
  return slotOrRoot.querySelector<HTMLElement>('.bb-card') || null;
}

/**
 * Animate element using WAAPI if possible; otherwise fallback to a safe CSS-transition.
 */
function animateTranslate(el: HTMLElement, dx: number, dy: number) {
  // WAAPI path (best — doesn't fight React className updates)
  const anyEl = el as unknown as { animate?: any };
  if (typeof anyEl.animate === 'function') {
    try {
      anyEl.animate(
        [
          { transform: 'translate3d(0px,0px,0px) scale(1)' },
          { transform: `translate3d(${dx}px, ${dy}px, 0px) scale(1.06)` },
          { transform: 'translate3d(0px,0px,0px) scale(1)' },
        ],
        {
          duration: DURATION_MS + RETURN_MS,
          easing: 'cubic-bezier(.18,.9,.22,1)',
          fill: 'none',
        },
      );
      return;
    } catch {
      // fallback below
    }
  }

  // Fallback: inline transform with transition (still SSR-safe; no portals)
  const prevTransition = el.style.transition;
  const prevTransform = el.style.transform;

  el.style.willChange = 'transform';
  el.style.transition = `transform ${DURATION_MS}ms cubic-bezier(.18,.9,.22,1)`;

  // Start (ensure it commits)
  el.style.transform = 'translate3d(0px,0px,0px)';

  requestAnimationFrame(() => {
    el.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;
    window.setTimeout(() => {
      el.style.transition = `transform ${RETURN_MS}ms cubic-bezier(.18,.9,.22,1)`;
      el.style.transform = 'translate3d(0px,0px,0px)';

      window.setTimeout(() => {
        el.style.transition = prevTransition;
        el.style.transform = prevTransform;
        el.style.willChange = '';
      }, RETURN_MS + 40);
    }, DURATION_MS);
  });
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Debug switch: ?fxdebug=1
  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!events || events.length === 0) return;

    let raf = 0;
    let alive = true;

    const run = () => {
      if (!alive) return;

      for (const e of events) {
        if (!e || e.type !== 'attack') continue;
        if (!e.id) continue;
        if (seenIdsRef.current.has(e.id)) continue;

        // mark seen early to avoid duplicates
        seenIdsRef.current.add(e.id);

        const attempt = (framesLeft: number) => {
          if (!alive) return;

          const aRoot = getBestUnitRootById(e.attackerId);
          const tRoot = getBestUnitRootById(e.targetId);

          const aCard = aRoot ? findCard(aRoot) : null;
          const tCard = tRoot ? findCard(tRoot) : null;

          const motion = aRoot ? findMotionLayer(aRoot) : null;

          if (!aCard || !tCard || !motion) {
            if (framesLeft > 0) {
              raf = window.requestAnimationFrame(() => attempt(framesLeft - 1));
            } else if (debugEnabled) {
              // eslint-disable-next-line no-console
              console.log('[FX] attack missing DOM', {
                id: e.id,
                attackerId: e.attackerId,
                targetId: e.targetId,
                hasAttackerRoot: !!aRoot,
                hasTargetRoot: !!tRoot,
                hasAttackerCard: !!aCard,
                hasTargetCard: !!tCard,
                hasMotion: !!motion,
              });
            }
            return;
          }

          const aRect = aCard.getBoundingClientRect();
          const tRect = tCard.getBoundingClientRect();
          const { dx, dy } = computeTouchDelta(aRect, tRect);

          // Animate ORIGINAL: move the existing wrapper that contains the card
          animateTranslate(motion, dx, dy);

          // Target feedback (optional; safe attribute so React won't wipe className)
          tCard.setAttribute('data-fx-attack-target', '1');
          window.setTimeout(() => {
            try {
              tCard.removeAttribute('data-fx-attack-target');
            } catch {}
          }, 240);
        };

        attempt(RETRY_FRAMES);
      }
    };

    // Kick once per events array update
    run();

    return () => {
      alive = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [events, debugEnabled]);

  // No visual layer needed; we only animate existing DOM nodes.
  return null;
}
