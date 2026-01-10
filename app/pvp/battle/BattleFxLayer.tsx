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

const DURATION = 360;
const RETURN_DURATION = 220;
const RETRY_FRAMES = 24;

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

  const maxMove = Math.max(a.width, a.height) * 1.05;
  const len = Math.hypot(dx, dy) || 1;
  const k = clamp(maxMove / len, 0.45, 0.95);

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

function getElsByUnitId(unitId: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`));
}

function pickSlotOrCard(unitId: string) {
  const list = getElsByUnitId(unitId);
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  const card = list.find((el) => el.classList.contains('bb-card'));
  if (card) return card;

  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }
  return list[0];
}

function findCard(root: HTMLElement) {
  if (root.classList.contains('bb-card')) return root;
  return root.querySelector<HTMLElement>('.bb-card') || root;
}

/**
 * FINAL HACK:
 * Sometimes the visually top layer is NOT the DOM node we are animating.
 * So we select the ACTUAL TOPMOST element under the attacker card center using elementFromPoint,
 * then walk up to a reasonable container (bb-card / bb-slot / data-unit-id) and animate THAT.
 */
function findTopVisibleForAttack(attackerCard: HTMLElement, attackerId: string): HTMLElement {
  const r = attackerCard.getBoundingClientRect();
  const c = rectCenter(r);

  const el = document.elementFromPoint(c.x, c.y) as HTMLElement | null;
  if (!el) return attackerCard;

  const slot = attackerCard.closest('.bb-slot') as HTMLElement | null;

  // Helper: is candidate inside same slot (ideal)
  const inSameSlot = (cand: HTMLElement) => {
    if (!slot) return false;
    return slot.contains(cand);
  };

  // Walk up from elementFromPoint to find best candidate
  let cur: HTMLElement | null = el;
  for (let i = 0; i < 14 && cur; i++) {
    if (cur.getAttribute('data-unit-id') === attackerId) return cur;
    if (cur.classList.contains('bb-card')) return cur;
    if (cur.classList.contains('bb-slot')) return cur;
    if (inSameSlot(cur) && cur.className && cur.className.toString().includes('bb-')) return cur;
    cur = cur.parentElement;
  }

  // fallback: if point element is inside same slot, animate it (top layer)
  if (slot && el && slot.contains(el)) return el;

  return attackerCard;
}

type Active = {
  el: HTMLElement;
  transform: string;
  transition: string;
  willChange: string;
  z: string;
  t1: number | null;
  t2: number | null;
};

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seen = useRef<Set<string>>(new Set());
  const active = useRef<WeakMap<HTMLElement, Active>>(new WeakMap());

  const [mounted, setMounted] = useState(false);
  const [hud, setHud] = useState('');
  const [cnt, setCnt] = useState(0);

  const debug = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const rafs: number[] = [];
    const timers: any[] = [];
    if (debug) setCnt((events || []).length);

    const stop = (el: HTMLElement) => {
      const st = active.current.get(el);
      if (!st) return;

      try {
        if (st.t1) window.clearTimeout(st.t1);
        if (st.t2) window.clearTimeout(st.t2);
      } catch {}

      try {
        el.style.transform = st.transform;
        el.style.transition = st.transition;
        el.style.willChange = st.willChange;
        el.style.zIndex = st.z;
      } catch {}

      active.current.delete(el);
    };

    const kick = (el: HTMLElement, dx: number, dy: number) => {
      if (active.current.has(el)) return;

      const st: Active = {
        el,
        transform: el.style.transform || '',
        transition: el.style.transition || '',
        willChange: el.style.willChange || '',
        z: el.style.zIndex || '',
        t1: null,
        t2: null,
      };
      active.current.set(el, st);

      el.style.willChange = 'transform';
      el.style.zIndex = '80';

      el.style.transition = 'none';
      el.style.transform = 'translate3d(0px, 0px, 0px)';
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetHeight;

      el.style.transition = `transform ${DURATION}ms cubic-bezier(.18,.9,.22,1)`;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0px)`;

      st.t1 = window.setTimeout(() => {
        el.style.transition = `transform ${RETURN_DURATION}ms cubic-bezier(.2,.8,.2,1)`;
        el.style.transform = 'translate3d(0px, 0px, 0px)';

        st.t2 = window.setTimeout(() => stop(el), RETURN_DURATION + 40);
      }, DURATION + 10);
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const aRoot = pickSlotOrCard(attackerId);
      const tRoot = pickSlotOrCard(targetId);
      if (!aRoot || !tRoot) return false;

      const aCard = findCard(aRoot);
      const tCard = findCard(tRoot);

      const ar = aCard.getBoundingClientRect();
      const tr = tCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      const moveEl = findTopVisibleForAttack(aCard, attackerId);

      if (debug) {
        const tag = moveEl === aCard ? 'bb-card' : moveEl.classList.contains('bb-slot') ? 'bb-slot' : moveEl.tagName;
        setHud(`FX: OK\nmove=elementFromPoint(${tag})\ndx=${Math.round(dx)} dy=${Math.round(dy)}`);
        timers.push(window.setTimeout(() => setHud(''), 900));
      }

      kick(moveEl, dx, dy);
      return true;
    };

    const runWithRetry = (attackerId: string, targetId: string) => {
      let frame = 0;
      const tick = () => {
        frame += 1;
        const ok = tryOnce(attackerId, targetId);
        if (ok) return;

        if (frame < RETRY_FRAMES) rafs.push(requestAnimationFrame(tick));
        else if (debug) {
          setHud(`FX: failed (DOM/rect)\nattacker=${attackerId}\ntarget=${targetId}`);
          timers.push(window.setTimeout(() => setHud(''), 1200));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seen.current.has(e.id)) continue;

      seen.current.add(e.id);
      timers.push(window.setTimeout(() => seen.current.delete(e.id), DURATION + RETURN_DURATION + 900));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const r of rafs) cancelAnimationFrame(r);
      for (const t of timers) clearTimeout(t);
      try {
        active.current = new WeakMap();
      } catch {}
    };
  }, [events, debug, mounted]);

  if (!mounted) return null;

  const css = debug
    ? `
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
    }`
    : '';

  return createPortal(
    <>
      {debug ? <style>{css}</style> : null}
      {debug ? <div className="bb-fx-debug-hud">{`FX events: ${cnt}\n${hud}`}</div> : null}
    </>,
    document.body
  );
}
