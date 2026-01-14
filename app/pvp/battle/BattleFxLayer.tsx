'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Attack event contract coming from page.tsx
export type AttackFxEvent = {
  type: 'attack';
  id: string;
  attackerId: string;
  targetId: string;
};

type ActiveAttack = {
  id: string;
  attackerId: string;
  targetId: string;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

// Prefer moving the dedicated motion wrapper if it exists, otherwise move the card root.
function pickMovable(el: HTMLElement): HTMLElement {
  // If the resolved element is already the dedicated motion wrapper, move it directly.
  if (el.classList.contains('battle-unit-card') || el.classList.contains('bb-motion-layer')) return el;
  const motionLayer = el.querySelector('.bb-motion-layer') as HTMLElement | null;
  if (motionLayer) return motionLayer;
  const card = el.querySelector('.bb-card') as HTMLElement | null;
  if (card) return card;
  return el;
}

function getUnitEl(unitId: string): HTMLElement | null {
  const w = window as any;
  const map = w.__bb_unitEls as Record<string, HTMLElement> | undefined;
  if (map && map[unitId]) return map[unitId];
  return document.querySelector(`[data-unit-id="${CSS.escape(unitId)}"]`) as HTMLElement | null;
}

function getMovableForUnit(unitId: string): HTMLElement | null {
  // Prefer the dedicated motion wrapper introduced in page.tsx
  const direct = document.querySelector(
    `.battle-unit-card[data-unit-id="${CSS.escape(unitId)}"]`
  ) as HTMLElement | null;
  if (direct) return direct;

  const unitEl = getUnitEl(unitId);
  if (!unitEl) return null;
  return pickMovable(unitEl);
}

async function animateAttack(attackerEl: HTMLElement, targetEl: HTMLElement, signal: { cancelled: boolean }) {
  const a = attackerEl.getBoundingClientRect();
  const t = targetEl.getBoundingClientRect();

  // Vector from attacker center -> target center
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  const tx = t.left + t.width / 2;
  const ty = t.top + t.height / 2;

  let dx = tx - ax;
  let dy = ty - ay;

  // Don't overshoot: approach ~55% of the distance, clamped.
  const dist = Math.hypot(dx, dy);
  const k = clamp(dist * 0.55, 40, 140) / (dist || 1);
  dx *= k;
  dy *= k;

  // WAAPI overrides transform on the element. We store current inline transform to restore.
  const prevTransform = attackerEl.style.transform;
  const prevWillChange = attackerEl.style.willChange;

  attackerEl.style.willChange = 'transform';

  // Quick in-out with a tiny "hit" shake.
  const anim = attackerEl.animate(
    [
      { transform: prevTransform || 'translate3d(0,0,0)' },
      { transform: `translate3d(${dx}px, ${dy}px, 0)` },
      { transform: `translate3d(${dx * 0.9}px, ${dy * 0.9}px, 0)` },
      { transform: prevTransform || 'translate3d(0,0,0)' },
    ],
    {
      duration: 380,
      easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)',
      fill: 'forwards',
    }
  );

  const cleanup = () => {
    try {
      anim.cancel();
    } catch {}
    attackerEl.style.transform = prevTransform;
    attackerEl.style.willChange = prevWillChange;
  };

  // Respect cancellation (race with unmount / new attack)
  const cancelWatcher = new Promise<void>((resolve) => {
    const tick = () => {
      if (signal.cancelled) {
        cleanup();
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await Promise.race([anim.finished.then(() => void 0).catch(() => void 0), cancelWatcher]);

  if (!signal.cancelled) {
    attackerEl.style.transform = prevTransform;
    attackerEl.style.willChange = prevWillChange;
  }
}

export default function BattleFxLayer({
  events,
  debug,
}: {
  events: AttackFxEvent[];
  debug?: boolean;
}) {
  const debugEnabled = !!debug;

  // Track processed events so we don't re-run the same attack animation on every render.
  const seenIdsRef = useRef<Set<string>>(new Set());

  const [active, setActive] = useState<ActiveAttack | null>(null);
  const activeRef = useRef<ActiveAttack | null>(null);
  activeRef.current = active;

  const [seenCount, setSeenCount] = useState(0);

  const lastEvent = useMemo(() => {
    if (!events || events.length === 0) return null;
    return events[events.length - 1];
  }, [events]);

  useEffect(() => {
    let mounted = true;
    return () => {
      mounted = false;
      void mounted;
    };
  }, []);

  useEffect(() => {
    if (!events || events.length === 0) return;

    // Find the newest unseen event.
    const seen = seenIdsRef.current;
    const newest = [...events].reverse().find((e) => !seen.has(e.id));
    if (!newest) return;

    seen.add(newest.id);
    setSeenCount(seen.size);

    // If an animation is already running, we queue by replacing active AFTER it ends.
    // For simplicity: just overwrite; animate effect below will cancel previous.
    setActive({ id: newest.id, attackerId: newest.attackerId, targetId: newest.targetId });
  }, [events]);

  useEffect(() => {
    if (!active) return;

    const attacker = getMovableForUnit(active.attackerId);
    const target = getMovableForUnit(active.targetId);

    if (!attacker || !target) {
      // Can't resolve DOM nodes yet (mount timing). Keep active for a bit by retrying next tick.
      const t = window.setTimeout(() => {
        // Trigger re-run by setting same active (no-op state update is ignored), so instead clear+set.
        setActive((cur) => (cur && cur.id === active.id ? { ...cur } : cur));
      }, 80);
      return () => window.clearTimeout(t);
    }

    const signal = { cancelled: false };

    void (async () => {
      try {
        await animateAttack(attacker, target, signal);
      } finally {
        if (!signal.cancelled) setActive(null);
      }
    })();

    return () => {
      signal.cancelled = true;
    };
  }, [active]);

  if (!debugEnabled) return null;

  return (
    <div
      className="bb-fx-debug"
      style={{
        position: 'fixed',
        left: 8,
        bottom: 90,
        width: 340,
        maxWidth: '80vw',
        fontSize: 12,
        lineHeight: 1.25,
        padding: 10,
        borderRadius: 12,
        background: 'rgba(0,0,0,0.45)',
        color: '#fff',
        zIndex: 999999,
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>FX debug</div>
      <div>events: {events?.length ?? 0}</div>
      <div>seen: {seenCount}</div>
      {active ? (
        <div style={{ marginTop: 8 }}>
          <div>active: {active.id}</div>
          <div>attacker: {active.attackerId}</div>
          <div>target: {active.targetId}</div>
        </div>
      ) : lastEvent ? (
        <div style={{ marginTop: 8 }}>
          <div>last: {lastEvent.id}</div>
          <div>attacker: {lastEvent.attackerId}</div>
          <div>target: {lastEvent.targetId}</div>
        </div>
      ) : null}
    </div>
  );
}
