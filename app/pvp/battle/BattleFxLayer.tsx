'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

export type FxEvent =
  | {
      type: 'attack';
      id: string;
      attackerId: string;
      targetId: string;
    };

const ATTACK_MS = 420; // matches bb_motion_lunge_to_target 420ms in battle.animations.css
const TARGET_HIT_MS = 220;
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

  // travel "almost" to the target, not full center-to-center
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

/** Always prefer the real .bb-slot (wrapper), never the inner .bb-card. */
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
  // prefer explicit marker
  const byAttr = slot.querySelector<HTMLElement>('.bb-motion-layer[data-fx-motion="1"]');
  return byAttr || slot.querySelector<HTMLElement>('.bb-motion-layer');
}

function getCard(slot: HTMLElement): HTMLElement | null {
  return slot.querySelector<HTMLElement>('.bb-card');
}

type Active = {
  attackerMotion: HTMLElement;
  targetCard: HTMLElement;
  prevAtkZ: string;
  prevTgtZ: string;
  t1?: number;
};

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const [mounted, setMounted] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const activeRef = useRef<Map<string, Active>>(new Map());

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const injectedCss = useMemo(
    () => `
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
.bb-fx-debug-outline-attacker{ outline:2px solid rgba(0,255,255,.85) !important; }
.bb-fx-debug-outline-target{ outline:2px solid rgba(255,0,255,.85) !important; }
`,
    []
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    if (!events || events.length === 0) return;

    const rafs: number[] = [];
    const timers: number[] = [];

    const cleanupById = (id: string) => {
      const st = activeRef.current.get(id);
      if (!st) return;

      try {
        st.attackerMotion.classList.remove('is-attacking');
        st.attackerMotion.style.removeProperty('--atk-dx');
        st.attackerMotion.style.removeProperty('--atk-dy');
        st.attackerMotion.style.zIndex = st.prevAtkZ;
      } catch {}

      try {
        st.targetCard.classList.remove('is-attack-target');
        st.targetCard.style.zIndex = st.prevTgtZ;
      } catch {}

      if (debugEnabled) {
        try {
          st.attackerMotion.classList.remove('bb-fx-debug-outline-attacker');
          st.targetCard.classList.remove('bb-fx-debug-outline-target');
        } catch {}
      }

      if (st.t1) {
        try {
          window.clearTimeout(st.t1);
        } catch {}
      }

      activeRef.current.delete(id);
    };

    const runOnce = (attack: FxEvent) => {
      const attackerSlot = getSlotByUnitId(attack.attackerId);
      const targetSlot = getSlotByUnitId(attack.targetId);
      if (!attackerSlot || !targetSlot) return false;

      const attackerMotion = getMotionLayer(attackerSlot);
      const targetCard = getCard(targetSlot);
      if (!attackerMotion || !targetCard) return false;

      const aRect = attackerMotion.getBoundingClientRect();
      const tRect = targetCard.getBoundingClientRect();
      if (!aRect.width || !aRect.height || !tRect.width || !tRect.height) return false;

      // stop previous with same id if any
      cleanupById(attack.id);

      const { dx, dy } = computeTouchDelta(aRect, tRect);

      // Save previous z-index (style only — doesn't touch layout positions)
      const prevAtkZ = attackerMotion.style.zIndex || '';
      const prevTgtZ = targetCard.style.zIndex || '';

      // IMPORTANT:
      // We rely on CSS animation .bb-motion-layer.is-attacking using --atk-dx/--atk-dy.
      // Do NOT set inline transform here, or it may override the animation.
      attackerMotion.style.setProperty('--atk-dx', `${dx}px`);
      attackerMotion.style.setProperty('--atk-dy', `${dy}px`);
      attackerMotion.style.zIndex = '60';

      targetCard.style.zIndex = '55';

      // Force animation restart reliably
      attackerMotion.classList.remove('is-attacking');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      attackerMotion.offsetHeight;
      attackerMotion.classList.add('is-attacking');

      // Target hit feedback uses existing CSS class .bb-card.is-attack-target
      targetCard.classList.remove('is-attack-target');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      targetCard.offsetHeight;
      targetCard.classList.add('is-attack-target');

      if (debugEnabled) {
        attackerMotion.classList.add('bb-fx-debug-outline-attacker');
        targetCard.classList.add('bb-fx-debug-outline-target');
      }

      const st: Active = { attackerMotion, targetCard, prevAtkZ, prevTgtZ };
      st.t1 = window.setTimeout(() => cleanupById(attack.id), Math.max(ATTACK_MS, TARGET_HIT_MS) + 90);
      activeRef.current.set(attack.id, st);
      timers.push(st.t1);

      return true;
    };

    const runWithRetry = (attack: FxEvent) => {
      let tries = 0;
      const tick = () => {
        tries += 1;
        const ok = runOnce(attack);
        if (ok) return;
        if (tries < RETRY_FRAMES) rafs.push(window.requestAnimationFrame(tick));
      };
      rafs.push(window.requestAnimationFrame(tick));
    };

    const pending = (events || []).filter((e) => e && e.type === 'attack' && e.id && !seenIdsRef.current.has(e.id));
    for (const e of pending) {
      seenIdsRef.current.add(e.id);
      // free seen id later (avoid unbounded set)
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), 4000));
      runWithRetry(e);
    }

    return () => {
      for (const r of rafs) {
        try {
          window.cancelAnimationFrame(r);
        } catch {}
      }
      for (const t of timers) {
        try {
          window.clearTimeout(t);
        } catch {}
      }
      // cleanup active
      for (const id of Array.from(activeRef.current.keys())) cleanupById(id);
    };
  }, [mounted, events, debugEnabled]);

  if (!mounted) return null;

  return (
    <>
      <style>{injectedCss}</style>
      {debugEnabled ? (
        <div className="bb-fx-debug-hud">{`fxEvents: ${events?.length ?? 0}\nseen: ${seenIdsRef.current.size}`}</div>
      ) : null}
    </>
  );
}
