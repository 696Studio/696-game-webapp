'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * BattleFxLayer — ATTACK TOUCH→BACK (WAAPI + SSR-safe)
 *
 * Key idea:
 * - We move the ORIGINAL card by animating the OUTER slot/wrapper that has data-unit-id
 * - Uses Web Animations API (element.animate) to avoid CSS/transform conflicts
 * - Fully SSR-safe: no document/window access before mount
 *
 * Debug:
 *   Add ?fxdebug=1 to URL to see HUD + outlines.
 */

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

  // Move mostly towards the target, but cap distance so it "touches" instead of teleporting
  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

function hasClassLike(el: HTMLElement, needle: string) {
  const c = (el.className || '').toString();
  return c.includes(needle);
}

/**
 * We DO NOT move CardArt internals.
 * We move the "best" outer container around the unit.
 */
function resolveVisualEl(unitRoot: HTMLElement): HTMLElement {
  // If the root itself is a card box, use it.
  if (unitRoot.classList.contains('bb-card')) return unitRoot;

  // If root is a slot rendered as `display: contents`, transforms won't apply.
  try {
    const d = window.getComputedStyle(unitRoot).display;
    if (d === 'contents') {
      const card = unitRoot.querySelector<HTMLElement>('.bb-card');
      if (card) return card;
    }
  } catch {}

  // Prefer the actual card element if it exists.
  const card = unitRoot.querySelector<HTMLElement>('.bb-card');
  if (card) return card;

  return unitRoot;
}

/**
 * We DO NOT move CardArt internals.
 * We move the "best" outer container around the unit.
 *
 * Important: if `.bb-slot` is `display: contents`, it cannot be transformed,
 * so we fall back to the `.bb-card` box.
 */
function findMoveEl(unitRoot: HTMLElement): HTMLElement {
  // If unitRoot is already the card, move it.
  if (unitRoot.classList.contains('bb-card')) return unitRoot;

  // 1) Best: slot wrapper (unless it's display:contents)
  const slot = unitRoot.closest('.bb-slot') as HTMLElement | null;
  if (slot) {
    try {
      const d = window.getComputedStyle(slot).display;
      if (d !== 'contents') return slot;
    } catch {
      return slot;
    }
    // display:contents -> move the visual card instead
    const cardInSlot = slot.querySelector<HTMLElement>('.bb-card');
    if (cardInSlot) return cardInSlot;
  }

  // 2) Any slot-like wrapper
  const slotLike = unitRoot.closest('[class*="slot"],[class*="Slot"],[data-slot],[data-slot-id]') as HTMLElement | null;
  if (slotLike) {
    try {
      const d = window.getComputedStyle(slotLike).display;
      if (d !== 'contents') return slotLike;
    } catch {
      return slotLike;
    }
    const card = slotLike.querySelector<HTMLElement>('.bb-card');
    if (card) return card;
  }

  // 3) Walk up a few levels and pick a container that looks like a slot/card block
  let cur: HTMLElement | null = unitRoot;
  for (let i = 0; i < 6 && cur; i++) {
    if (hasClassLike(cur, 'bb-slot') || hasClassLike(cur, 'slot') || hasClassLike(cur, 'bb-card') || hasClassLike(cur, 'card')) {
      try {
        const d = window.getComputedStyle(cur).display;
        if (d !== 'contents') return cur;
      } catch {
        return cur;
      }
    }
    cur = cur.parentElement;
  }

  return resolveVisualEl(unitRoot);
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const animByElRef = useRef<WeakMap<HTMLElement, Animation>>(new WeakMap());

  const [mounted, setMounted] = useState(false);
  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  useEffect(() => setMounted(true), []);

  const debugEnabled = useMemo(() => {
    if (!mounted) return false;
    try {
      return new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, [mounted]);

  const css = useMemo(
    () => `
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
        max-width: 60vw;
        white-space: pre-wrap;
      }
    `,
    []
  );

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) setDebugCount((events || []).length);

    const getElByUnitId = (unitId: string) =>
      document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(String(unitId))}"]`);

    const animateAttack = (moveEl: HTMLElement, dx: number, dy: number) => {
      // Cancel previous animation on this element (if any)
      const prev = animByElRef.current.get(moveEl);
      try {
        prev?.cancel();
      } catch {}

      // Ensure it can sit above neighbors during motion (z-index works only if positioned)
      const prevPos = moveEl.style.position;
      if (!prevPos) moveEl.style.position = 'relative';
      moveEl.style.willChange = 'transform';
      moveEl.style.zIndex = '60';

      // WAAPI: reliable even when CSS has transform stuff elsewhere
      let anim: Animation | null = null;
      try {
        anim = moveEl.animate(
          [
            { transform: 'translate3d(0px, 0px, 0) scale(1)' },
            { transform: `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`, offset: 0.55 },
            { transform: `translate3d(${dx * 0.92}px, ${dy * 0.92}px, 0) scale(1.0)`, offset: 0.7 },
            { transform: 'translate3d(0px, 0px, 0) scale(1)' }
          ],
          { duration: ATTACK_DURATION, easing: 'cubic-bezier(.18,.9,.22,1)', fill: 'both' }
        );
      } catch {
        anim = null;
      }

      if (anim) {
        animByElRef.current.set(moveEl, anim);
        anim.onfinish = () => {
          moveEl.style.willChange = '';
          moveEl.style.zIndex = '';
          // Keep position intact (do not touch layout), but revert our temporary inline position if we set it.
          if (!prevPos) moveEl.style.position = '';
          animByElRef.current.delete(moveEl);
        };
        anim.oncancel = () => {
          moveEl.style.willChange = '';
          moveEl.style.zIndex = '';
          if (!prevPos) moveEl.style.position = '';
          animByElRef.current.delete(moveEl);
        };
      } else {
        // Fallback: set inline transform directly (still touch→back)
        moveEl.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`;
        timers.push(
          window.setTimeout(() => {
            moveEl.style.transform = 'translate3d(0px, 0px, 0) scale(1)';
          }, Math.floor(ATTACK_DURATION * 0.55))
        );
        timers.push(
          window.setTimeout(() => {
            moveEl.style.transform = '';
            moveEl.style.willChange = '';
            moveEl.style.zIndex = '';
            if (!prevPos) moveEl.style.position = '';
          }, ATTACK_DURATION + 40)
        );
      }
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getElByUnitId(attackerId);
      const targetRoot = getElByUnitId(targetId);

      if (!attackerRoot || !targetRoot) return false;

      const attackerVisual = resolveVisualEl(attackerRoot);
      const targetVisual = resolveVisualEl(targetRoot);

      const ar = attackerVisual.getBoundingClientRect();
      const tr = targetVisual.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      const moveEl = findMoveEl(attackerRoot);

      if (debugEnabled) {
        attackerVisual.classList.add('bb-fx-debug-outline-attacker');
        targetVisual.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerVisual.classList.remove('bb-fx-debug-outline-attacker');
            targetVisual.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      animateAttack(moveEl, dx, dy);
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
          setDebugMsg(
            `FX: DOM not found for\nattackerId=${attackerId}\ntargetId=${targetId}\n(data-unit-id mismatch?)`
          );
          timers.push(window.setTimeout(() => setDebugMsg(''), 1400));
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
      // Cancel any running animations we started
      try {
        // WeakMap isn't iterable; we just let them finish. Safe.
      } catch {}
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{css}</style>
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
