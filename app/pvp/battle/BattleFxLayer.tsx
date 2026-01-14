'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Attack event contract coming from page.tsx
export type AttackFxEvent = {
  type: 'attack';
  id: string;
  attackerId: string;
  targetId: string;
};

/** CSS selector escaping for attribute selectors */
function cssEscape(value: string): string {
  const anyCss = (globalThis as any).CSS;
  if (anyCss && typeof anyCss.escape === "function") return anyCss.escape(value);
  // Minimal escape fallback
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\"');
}

/** Extract slot key like "p1:0" from composite ids. */
function extractSlotKey(compositeId: string): string | null {
  const parts = String(compositeId || "").split(":");
  const pIdx = parts.findIndex((p) => p === "p1" || p === "p2");
  if (pIdx >= 0 && pIdx + 1 < parts.length) {
    const side = parts[pIdx];
    const slot = parts[pIdx + 1];
    if (/^\d+$/.test(slot)) return `${side}:${slot}`;
  }
  return null;
}

/** Drop the round segment (":<round>:") from ids so DOM and events can match. */
function normalizeDropRound(compositeId: string): string {
  const parts = String(compositeId || "").split(":");
  // expected: matchId : round : pX : slot : cardId : unitId
  if (parts.length >= 3 && /^\d+$/.test(parts[1])) {
    parts.splice(1, 1);
  }
  return parts.join(":");
}

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
  const motionLayer = el.querySelector('.bb-motion-layer') as HTMLElement | null;
  if (motionLayer) return motionLayer;
  const card = el.querySelector('.bb-card') as HTMLElement | null;
  if (card) return card;
  return el;
}

function slotKeyFromId(id: string): string | null {
  const parts = id.split(':');
  // expected: <match>:<round>:<p1|p2>:<idx>:...
  if (parts.length >= 4 && (parts[2] === 'p1' || parts[2] === 'p2')) return `${parts[2]}:${parts[3]}`;
  return null;
}

function normalizeUnitId(id: string): string {
  // Unit ids often look like: <matchUuid>:<round>:p1:3:<teamUuid>:<cardUuid>
  // The <round> segment can differ between DOM and events. Normalize by dropping
  // the first UUID prefix and also the round segment when present.
  const parts = id.split(':');
  if (parts.length <= 1) return id;

  const firstLooksUuid = ((parts[0].match(/-/g) || []).length >= 4);
  const secondLooksRound = parts.length >= 2 && /^\d+$/.test(parts[1]);

  if (firstLooksUuid && secondLooksRound && parts.length >= 4) {
    return parts.slice(2).join(':'); // drop matchUuid + round
  }
  if (firstLooksUuid) {
    return parts.slice(1).join(':'); // drop matchUuid only
  }
  return id;
}

function getUnitEl(unitId: string, refMap?: Record<string, HTMLElement | null>): HTMLElement | null {
  if (!unitId) return null;

  // Events send a long id like:
  // matchId:round:p1:2:teamId:instanceId
  // But DOM usually stores only instanceId (uuid) in data-unit-id.
  const tail = unitId.includes(":") ? unitId.split(":").pop() || unitId : unitId;
  const slot = extractSlotKey(unitId); // p1:2

  const rmap = refMap;
  const gmap = (window as any).__bb_unitEls as Record<string, HTMLElement | undefined> | undefined;

  // 1) Ref map / global map by instanceId
  if (rmap && rmap[tail]) return rmap[tail] as HTMLElement;
  if (gmap && gmap[tail]) return gmap[tail];

  // 2) Ref map / global map by slot key
  if (slot) {
    if (rmap && rmap[slot]) return rmap[slot] as HTMLElement;
    if (gmap && gmap[slot]) return gmap[slot];
  }

  // 3) Direct DOM lookup by instanceId
  const el = document.querySelector(`[data-unit-id="${cssEscape(tail)}"]`) as HTMLElement | null;
  if (el) return el;

  // 4) DOM lookup by slot key (if page provides it)
  if (slot) {
    const sel = `[data-slot="${cssEscape(slot)}"]`;
    const bySlot = document.querySelector(sel) as HTMLElement | null;
    if (bySlot) return bySlot;
  }

  return null;
}


function collectDomSamples() {
  const ids = Array.from(document.querySelectorAll('[data-unit-id]'))
    .slice(0, 12)
    .map((el) => (el as HTMLElement).getAttribute('data-unit-id') || '');
  const slots = Array.from(document.querySelectorAll('[data-slot]'))
    .slice(0, 12)
    .map((el) => (el as HTMLElement).getAttribute('data-slot') || '');
  return { ids, slots, unitCount: document.querySelectorAll('[data-unit-id]').length, slotCount: document.querySelectorAll('[data-slot]').length };
}

function getMovableForUnit(
  unitId: string,
  unitElByIdRef?: React.MutableRefObject<Record<string, HTMLElement | null>>
): HTMLElement | null {
  const refMap = unitElByIdRef?.current;

  // Try exact id and normalized (round-agnostic) id
  const id0 = String(unitId || "");
  const id1 = normalizeDropRound(id0);

  const unitEl =
    getUnitEl(id0, refMap) ||
    (id1 !== id0 ? getUnitEl(id1, refMap) : null);

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

  // Store current inline transform to restore.
  const prevTransform = attackerEl.style.transform;
  const prevWillChange = attackerEl.style.willChange;
  const prevTransition = attackerEl.style.transition;

  attackerEl.style.willChange = 'transform';

  const base = prevTransform || 'translate3d(0,0,0)';
  const to1 = `${base} translate3d(${dx}px, ${dy}px, 0)`;
  const to2 = `${base} translate3d(${dx * 0.9}px, ${dy * 0.9}px, 0)`;

  const restore = () => {
    attackerEl.style.transform = prevTransform;
    attackerEl.style.willChange = prevWillChange;
    attackerEl.style.transition = prevTransition;
  };

  // If WAAPI is available, use it (best). Otherwise fallback to CSS transition (Telegram iOS often lacks WAAPI).
  const hasWAAPI = typeof (attackerEl as any).animate === 'function';

  if (hasWAAPI) {
    const anim = attackerEl.animate(
      [
        { transform: base },
        { transform: to1 },
        { transform: to2 },
        { transform: base },
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
      restore();
    };

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

    if (!signal.cancelled) restore();
    return;
  }

  // Fallback: CSS transition-based animation
  const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

  // Compose relative motion on top of base position
  attackerEl.style.transition = 'transform 170ms cubic-bezier(0.2, 0.9, 0.2, 1)';
  attackerEl.style.transform = base;

  // Ensure style is applied before transitioning
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (signal.cancelled) {
    restore();
    return;
  }

  attackerEl.style.transform = to1;
  await sleep(190);
  if (signal.cancelled) {
    restore();
    return;
  }

  attackerEl.style.transition = 'transform 140ms cubic-bezier(0.2, 0.9, 0.2, 1)';
  attackerEl.style.transform = base;
  await sleep(160);

  if (!signal.cancelled) restore();
}

export default function BattleFxLayer({
  events,
  debug,
  unitElByIdRef,
}: {
  events: AttackFxEvent[];
  debug?: boolean;
  unitElByIdRef?: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const debugEnabled = !!debug || (typeof window !== 'undefined' && window.localStorage?.getItem('bb_fx_debug') === '1');

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

  // Expose lightweight state for debugging in DevTools
  useEffect(() => {
    (window as any).__bb_fx_state = {
      eventsLen: events?.length ?? 0,
      seenCount,
      active,
      lastEvent,
    };
  }, [events, seenCount, active, lastEvent]);


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
      if (debugEnabled) {
        // eslint-disable-next-line no-console
        const aSlot = slotKeyFromId(active.attackerId);
        const tSlot = slotKeyFromId(active.targetId);
        const samples = collectDomSamples();
        const payload = {
          attackerId: active.attackerId,
          targetId: active.targetId,
          attackerFound: !!attacker,
          targetFound: !!target,
          attackerSlot: aSlot,
          targetSlot: tSlot,
          domUnitCount: samples.unitCount,
          domSlotCount: samples.slotCount,
          domIdsSample: samples.ids,
          domSlotsSample: samples.slots,
        };
        (window as any).__bb_fx_lastFail = payload;
        console.warn('[BB FX] cannot resolve DOM', payload);
}
      (window as any).__bb_fx_resolve = {
        attackerId: active.attackerId,
        targetId: active.targetId,
        attackerFound: !!attacker,
        targetFound: !!target,
        ts: Date.now(),
      };

      // Can't resolve DOM nodes yet (mount timing or ID mismatch). Retry shortly.
      const t = window.setTimeout(() => {
        setActive((cur) => (cur && cur.id === active.id ? { ...cur } : cur));
      }, 120);
      return () => window.clearTimeout(t);
    }

    const signal = { cancelled: false };

    if (debugEnabled) {
      attacker.style.outline = '2px solid rgba(0,255,255,0.9)';
      attacker.style.outlineOffset = '2px';
      (window as any).__bb_fx_anim = { attackerId: active.attackerId, targetId: active.targetId, ts: Date.now() };
    }

    void (async () => {
      try {
        await animateAttack(attacker, target, signal);
      } finally {
        if (debugEnabled) {
          attacker.style.outline = '';
          attacker.style.outlineOffset = '';
        }
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
      <div style={{ opacity: 0.85 }}>toggle: localStorage.bb_fx_debug='1'</div>
      <div>events: {events?.length ?? 0}</div>
      <div>seen: {seenCount}</div>
      <div style={{ opacity: 0.85 }}>dom: {(typeof document !== 'undefined') ? document.querySelectorAll('[data-unit-id]').length : 0} ids / {(typeof document !== 'undefined') ? document.querySelectorAll('[data-slot]').length : 0} slots</div>
      <div style={{ opacity: 0.85 }}>resolve: {(window as any).__bb_fx_resolve ? `${(window as any).__bb_fx_resolve.attackerFound ? 'A' : 'a'}${(window as any).__bb_fx_resolve.targetFound ? 'T' : 't'}` : '-'}</div>
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
