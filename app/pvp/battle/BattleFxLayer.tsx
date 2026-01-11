'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_DURATION = 520;
const TARGET_HIT_DURATION = 220;
const RETRY_FRAMES = 28;

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

  // We don't want full travel to the target center — just touch-ish.
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

/** Always prefer the real .bb-slot, never the inner .bb-card. */
function getSlotByUnitId(unitId: string): HTMLElement | null {
  const sel = `[data-unit-id="${safeEscape(String(unitId))}"]`;
  const list = Array.from(document.querySelectorAll<HTMLElement>(sel));
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  // fallback: maybe the attribute is on a child in some older builds
  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }
  return null;
}

function getMotionLayer(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>('.bb-motion-layer');
}

function getCard(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>('.bb-card');
}

type ActiveAnim = {
  el: HTMLElement;
  anim: Animation;
  prevTransform: string;
  prevTransition: string;
  prevWillChange: string;
  prevZ: string;
};

export default function BattleFxLayer({ events, debug, debugAttack }: { events: FxEvent[]; debug?: boolean; debugAttack?: { attackerId?: string; targetId?: string; nonce?: number } }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const activeRef = useRef<Map<HTMLElement, ActiveAnim>>(new Map());
  const [mounted, setMounted] = useState(false);
  const [dbgGeom, setDbgGeom] = useState<null | {
    a: { x: number; y: number };
    t: { x: number; y: number };
    touch: { x: number; y: number };
    dx: number;
    dy: number;
    attackerId: string;
    targetId: string;
  }>(null);


  const debugEnabled = !!debug;

  const injectedCss = useMemo(
    () => `
/* =========================
   FX injected by BattleFxLayer (WAAPI + tiny helpers)
   ========================= */
.bb-fx-debug-hud {
  position: fixed;
  right: 10px;
  bottom: 10px;
  z-index: 10000;
  pointer-events: none;
  font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: rgba(255,255,255,0.92);
  background: rgba(0,0,0,0.55);
  padding: 8px 10px;
  border-radius: 10px;
  backdrop-filter: blur(6px);
  max-width: 70vw;
  white-space: pre-wrap;
}
.bb-fx-debug-outline-attacker { outline: 2px solid rgba(0,255,255,0.85) !important; }
.bb-fx-debug-outline-target   { outline: 2px solid rgba(255,0,255,0.85) !important; }
.bb-fx-debug-svg {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
`,
    []
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    const manualNonce = debugAttack?.nonce ?? 0;
    const manualOk = debugEnabled && manualNonce && debugAttack?.attackerId && debugAttack?.targetId;
    if ((!events || events.length === 0) && !manualOk) return;

    const timers: Array<number> = [];
    const rafs: Array<number> = [];

    const stop = (el: HTMLElement) => {
      const st = activeRef.current.get(el);
      if (!st) return;

      try {
        st.anim.cancel();
      } catch {}

      try {
        el.style.transform = st.prevTransform;
        el.style.transition = st.prevTransition;
        el.style.willChange = st.prevWillChange;
        el.style.zIndex = st.prevZ;
      } catch {}

      activeRef.current.delete(el);
    };

    const animateOnce = (attack: FxEvent) => {
      const attackerSlot = getSlotByUnitId(attack.attackerId);
      const targetSlot = getSlotByUnitId(attack.targetId);
      if (!attackerSlot || !targetSlot) return false;

      const motion = getMotionLayer(attackerSlot);
      const targetCard = getCard(targetSlot);
      if (!motion || !targetCard) return false;

      // stop previous animation on same element
      stop(motion);
      stop(targetCard);

      const aRect = motion.getBoundingClientRect();
      const tRect = targetCard.getBoundingClientRect();
      const { dx, dy } = computeTouchDelta(aRect, tRect);
      if (debugEnabled) {
        const ac = rectCenter(aRect);
        const tc = rectCenter(tRect);
        setDbgGeom({
          a: ac,
          t: tc,
          touch: { x: ac.x + dx, y: ac.y + dy },
          dx,
          dy,
          attackerId: String(attack.attackerId),
          targetId: String(attack.targetId),
        });
      }

      // WAAPI: this bypasses "className overwritten by React" and any CSS import issues.
      const prevTransform = motion.style.transform;
      const prevTransition = motion.style.transition;
      const prevWillChange = motion.style.willChange;
      const prevZ = motion.style.zIndex;

      motion.style.willChange = 'transform';
      motion.style.transition = 'none';
      motion.style.zIndex = '60';

      const anim = motion.animate(
        [
          { transform: 'translate3d(0px,0px,0) scale(1)' },
          { transform: `translate3d(${dx}px,${dy}px,0) scale(1.04)`, offset: 0.55 },
          { transform: `translate3d(${dx * 0.92}px,${dy * 0.92}px,0) scale(1.0)`, offset: 0.72 },
          { transform: 'translate3d(0px,0px,0) scale(1)' },
        ],
        { duration: ATTACK_DURATION, easing: 'cubic-bezier(.18,.9,.22,1)', fill: 'both' }
      );

      activeRef.current.set(motion, { el: motion, anim, prevTransform, prevTransition, prevWillChange, prevZ });

      // Small target hit feedback (doesn't move layout)
      const prevT = targetCard.style.transform;
      const prevTT = targetCard.style.transition;
      const prevTW = targetCard.style.willChange;
      const prevTZ = targetCard.style.zIndex;

      targetCard.style.willChange = 'transform, filter';
      targetCard.style.transition = 'none';
      targetCard.style.zIndex = '55';

      const hit = targetCard.animate(
        [
          { transform: 'translate3d(0,0,0) scale(1)', filter: 'brightness(1)' as any },
          { transform: 'translate3d(0,0,0) scale(0.985)', filter: 'brightness(1.15)' as any, offset: 0.55 },
          { transform: 'translate3d(0,0,0) scale(1)', filter: 'brightness(1)' as any },
        ],
        { duration: TARGET_HIT_DURATION, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' }
      );

      activeRef.current.set(targetCard, {
        el: targetCard,
        anim: hit,
        prevTransform: prevT,
        prevTransition: prevTT,
        prevWillChange: prevTW,
        prevZ: prevTZ,
      });

      if (debugEnabled) {
        motion.classList.add('bb-fx-debug-outline-attacker');
        targetCard.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            motion.classList.remove('bb-fx-debug-outline-attacker');
            targetCard.classList.remove('bb-fx-debug-outline-target');
          }, 900)
        );
      }

      // cleanup after anim end
      const cleanup = () => {
        stop(motion);
        stop(targetCard);
      };
      timers.push(window.setTimeout(cleanup, ATTACK_DURATION + 60));

      return true;
    };

    // Process only new attack events, in order
    const manualNonce2 = debugAttack?.nonce ?? 0;
    const manualEvent: FxEvent | null =
      debugEnabled && manualNonce2 && debugAttack?.attackerId && debugAttack?.targetId
        ? { type: 'attack', id: `dbg-${manualNonce2}`, attackerId: String(debugAttack.attackerId), targetId: String(debugAttack.targetId) }
        : null;
    const merged = manualEvent ? [...(events || []), manualEvent] : (events || []);
    const pending = merged.filter((e) => e && e.type === 'attack' && !seenIdsRef.current.has(e.id));

    for (const e of pending) {
      seenIdsRef.current.add(e.id);

      // DOM might not be ready at exact tick (re-render), so retry a few frames
      let tries = 0;
      const tryRun = () => {
        tries++;
        const ok = animateOnce(e);
        if (ok) return;
        if (tries < RETRY_FRAMES) {
          rafs.push(window.requestAnimationFrame(tryRun));
        }
      };
      rafs.push(window.requestAnimationFrame(tryRun));
    }

    return () => {
      for (const id of timers) {
        try {
          window.clearTimeout(id);
        } catch {}
      }
      for (const id of rafs) {
        try {
          window.cancelAnimationFrame(id);
        } catch {}
      }
      // stop everything
      for (const el of Array.from(activeRef.current.keys())) stop(el);
    };
  }, [mounted, events, debugEnabled, debugAttack?.nonce, debugAttack?.attackerId, debugAttack?.targetId]);

  if (!mounted) return null;

  return (
    <>
      <style>{injectedCss}</style>
      {debugEnabled ? (
        <div className="bb-fx-debug-hud">
          {`fxEvents: ${events?.length ?? 0}\nseen: ${seenIdsRef.current.size}\n` + (dbgGeom ? `attacker: ${dbgGeom.attackerId}\ntarget: ${dbgGeom.targetId}\ndx: ${Math.round(dbgGeom.dx)} dy: ${Math.round(dbgGeom.dy)}\n` : '')}
        </div>
      ) : null}
    </>
  );
}
