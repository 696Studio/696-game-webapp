'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

declare global {
  interface Window {
    __bb_fx_build?: string;

    __bb_fx_ping?: () => void;
    __bb_fx_testFly?: (fromSlot: string, toSlot: string) => boolean;

    __bb_fx_domCount?: number;
    __bb_fx_regCount?: number;

    __bb_fx_lastFail?: any;
    __bb_fx_lastAtk?: any;
    __bb_fx_atkCount?: number;

    __bb_fx_slotCenters?: Record<string, { x: number; y: number; w: number; h: number; t: number }>;
    __bb_fx_queue?: Array<{
      k: string;
      attackerSlot: string;
      targetSlot: string;
      createdAt: number;
      expiresAt: number;
      type: string;
      idx: number;
    }>;
    __bb_fx_queueLen?: number;

    // v23 debug
    __bb_fx_lastAttackLikeLen?: number;
    __bb_fx_lastEnqueue?: any;
  }
}

type FxEvent = {
  type?: string;
  ts?: number;
  attackerId?: string;
  targetId?: string;
  attackerSlot?: string;
  targetSlot?: string;
  [k: string]: any;
};



const flashAt = (p: { x: number; y: number }, root: HTMLElement | null) => {
  if (!root) return;
  const ring = document.createElement('div');
  ring.style.position = 'fixed';
  ring.style.left = `${p.x - 40}px`;
  ring.style.top = `${p.y - 40}px`;
  ring.style.width = '80px';
  ring.style.height = '80px';
  ring.style.borderRadius = '999px';
  ring.style.border = '4px solid rgba(255,0,170,0.95)';
  ring.style.boxShadow = '0 0 28px rgba(255,0,170,0.85)';
  ring.style.pointerEvents = 'none';
  ring.style.zIndex = '2147483647';
  ring.style.willChange = 'transform, opacity';
  root.appendChild(ring);

  const anim = ring.animate(
    [
      { transform: 'scale(0.4)', opacity: 0.95 },
      { transform: 'scale(1.1)', opacity: 0.7 },
      { transform: 'scale(1.4)', opacity: 0 },
    ],
    { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
  );
  anim.onfinish = () => {
    try { ring.remove(); } catch {}
  };
};

const FX_DURATION_MS = 420;
const FX_GAP_MS = 120;
const FX_WINDOW_MS = 2000;
const TICK_MS = 50;
const CACHE_POLL_MS = 100;

function extractSlotKey(id: string): string | null {
  if (!id) return null;
  const direct = id.match(/\b(p1|p2):([0-4])\b/);
  if (direct) return `${direct[1]}:${direct[2]}`;
  const parts = id.split(':');
  for (let i = 0; i < parts.length - 1; i++) {
    const side = parts[i];
    const slot = parts[i + 1];
    if ((side === 'p1' || side === 'p2') && /^[0-4]$/.test(slot)) return `${side}:${slot}`;
  }
  return null;
}

function isUsableEl(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && !!(el as any).isConnected;
}

function findSlotEl(slotKey: string): HTMLElement | null {
  try {
    return document.querySelector(`[data-bb-slot="${CSS.escape(slotKey)}"]`) as HTMLElement | null;
  } catch {
    return document.querySelector(`[data-bb-slot="${slotKey}"]`) as HTMLElement | null;
  }
}

function centerOfRect(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

export default function BattleFxLayer({
  events,
  slotRegistryRef,
  laneCenters,
}: {
  events: FxEvent[];
  slotRegistryRef?: React.MutableRefObject<Record<string, HTMLElement | null>>;
  laneCenters?: Record<string, { x: number; y: number }>;
}) {
  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  const [queueLenState, setQueueLenState] = useState<number>(() => (typeof window !== 'undefined' ? (window.__bb_fx_queueLen ?? 0) : 0));

  const [mounted, setMounted] = useState(false);
  const portalRootRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const playingUntilRef = useRef<number>(0);
  const queueRef = useRef<NonNullable<Window['__bb_fx_queue']>>([]);
  const centersRef = useRef<NonNullable<Window['__bb_fx_slotCenters']>>({});

  if (typeof window !== 'undefined') {
    window.__bb_fx_build = 'BattleFxLayer.attack.motion.v26';
    if (!window.__bb_fx_slotCenters) window.__bb_fx_slotCenters = {};
    if (!window.__bb_fx_queue) window.__bb_fx_queue = [];
  }

  useEffect(() => {
    portalRootRef.current = document.body;
    setMounted(true);

    // Adopt persisted state (survive remount)
    queueRef.current = (window.__bb_fx_queue || []).slice();
    centersRef.current = { ...(window.__bb_fx_slotCenters || {}) };
    setQueueLenState(queueRef.current.length);
    window.__bb_fx_queueLen = queueRef.current.length;

    return () => {
      window.__bb_fx_queue = queueRef.current.slice();
      window.__bb_fx_slotCenters = { ...centersRef.current };
      window.__bb_fx_queueLen = queueRef.current.length;
    };
  }, []);

  // Debug flag poll (Telegram WebView)
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        setDebug(localStorage.getItem('bb_fx_debug') === '1');
      } catch {}
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // Slot-center cache poller (fills cacheKeys)
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        const nodes = Array.from(document.querySelectorAll('[data-bb-slot]')) as HTMLElement[];
        window.__bb_fx_domCount = nodes.length;

        const regCount = slotRegistryRef?.current
          ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
          : 0;
        window.__bb_fx_regCount = regCount;

        if (!nodes.length) return;
        const now = Date.now();
        for (const el of nodes) {
          const k = el.getAttribute('data-bb-slot');
          if (!k) continue;
          const c = centerOfRect(el.getBoundingClientRect());
          centersRef.current[k] = { x: c.x, y: c.y, w: c.w, h: c.h, t: now };
        }
        window.__bb_fx_slotCenters = { ...centersRef.current };
      } catch {}
    }, CACHE_POLL_MS);
    return () => window.clearInterval(t);
  }, [slotRegistryRef]);

  const resolvePoint = (slotKey: string): { x: number; y: number } | null => {
    // 1) registry
    const reg = slotRegistryRef?.current || {};
    const el = reg[slotKey];
    if (isUsableEl(el)) {
      const c = centerOfRect(el.getBoundingClientRect());
      centersRef.current[slotKey] = { x: c.x, y: c.y, w: c.w, h: c.h, t: Date.now() };
      window.__bb_fx_slotCenters = { ...centersRef.current };
      return { x: c.x, y: c.y };
    }

    // 2) DOM
    const qs = findSlotEl(slotKey);
    if (isUsableEl(qs)) {
      const c = centerOfRect(qs.getBoundingClientRect());
      centersRef.current[slotKey] = { x: c.x, y: c.y, w: c.w, h: c.h, t: Date.now() };
      window.__bb_fx_slotCenters = { ...centersRef.current };
      return { x: c.x, y: c.y };
    }

    // 3) page deterministic centers
    const lc = laneCenters?.[slotKey];
    if (lc) return { x: lc.x, y: lc.y };

    // 4) cache
    const cached = centersRef.current[slotKey] || window.__bb_fx_slotCenters?.[slotKey];
    if (cached) return { x: cached.x, y: cached.y };

    return null;
  };

  
  const pickMoveEl = (slotEl: HTMLElement): HTMLElement => {
    const byClass =
      (slotEl.querySelector('.bb-card') as HTMLElement | null) ||
      (slotEl.querySelector('[class*="bb-card"]') as HTMLElement | null) ||
      (slotEl.querySelector('[class*="cardart"]') as HTMLElement | null) ||
      (slotEl.querySelector('[class*="CardArt"]') as HTMLElement | null);
    return byClass || (slotEl.firstElementChild as HTMLElement) || slotEl;
  };

  const lungeCard = (fromSlot: string, toSlot: string) => {
    const fromSlotEl = findSlotEl(fromSlot);
    const toSlotEl = findSlotEl(toSlot);
    if (!isUsableEl(fromSlotEl) || !isUsableEl(toSlotEl)) return false;

    const fromRect = fromSlotEl.getBoundingClientRect();
    const toRect = toSlotEl.getBoundingClientRect();
    const a = centerOfRect(fromRect);
    const b = centerOfRect(toRect);

    const dx = (b.x - a.x) * 0.35;
    const dy = (b.y - a.y) * 0.35;

    const moveEl = pickMoveEl(fromSlotEl);

    const prevZ = moveEl.style.zIndex;
    const prevWill = moveEl.style.willChange;
    const prevTransform = moveEl.style.transform;

    moveEl.style.willChange = 'transform';
    moveEl.style.zIndex = '9999';

    const anim = moveEl.animate(
      [
        { transform: prevTransform || 'translate3d(0px,0px,0px)' },
        { transform: `translate3d(${dx}px, ${dy}px, 0px) scale(1.04)` },
        { transform: prevTransform || 'translate3d(0px,0px,0px)' },
      ],
      { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );

    anim.onfinish = () => {
      try {
        moveEl.style.zIndex = prevZ;
        moveEl.style.willChange = prevWill;
        moveEl.style.transform = prevTransform;
      } catch {}
    };

    return true;
  };

const flyDot = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const dot = document.createElement('div');
    dot.style.position = 'fixed';
    dot.style.left = `${from.x - 14}px`;
    dot.style.top = `${from.y - 14}px`;
    dot.style.width = '28px';
    dot.style.height = '28px';
    dot.style.borderRadius = '999px';
    dot.style.background = 'rgba(255,0,170,0.95)';
    dot.style.boxShadow = '0 0 22px rgba(255,0,170,0.8)';
    dot.style.pointerEvents = 'none';
    dot.style.zIndex = '2147483647';
    dot.style.willChange = 'transform, opacity';
    overlay.appendChild(dot);

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const anim = dot.animate(
      [
        { transform: 'translate3d(0px,0px,0px)', opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, opacity: 0 },
      ],
      { duration: FX_DURATION_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );

    anim.onfinish = () => {
      try {
        dot.remove();
      } catch {}
    };

    return true;
  };

  const playOnce = (attackerSlot: string, targetSlot: string) => {
    const a = resolvePoint(attackerSlot);
    const b = resolvePoint(targetSlot);
    if (!a || !b) return false;

    (window as any).__bb_fx_lastPlayed = { ts: Date.now(), from: attackerSlot, to: targetSlot, ax: a.x, ay: a.y, bx: b.x, by: b.y };

    // Primary: move the real attacker card element
    const moved = lungeCard(attackerSlot, targetSlot);

    // Secondary: flash on target for hit feedback (hard to miss)
    flashAt(b, overlayRef.current);

    return moved;
  };

  // Scheduler ticker
  useEffect(() => {
    const t = window.setInterval(() => {
      const now = Date.now();

      // persist
      window.__bb_fx_queueLen = queueRef.current.length;
      window.__bb_fx_queue = queueRef.current.slice();
      setQueueLenState(queueRef.current.length);

      if (now < playingUntilRef.current) return;

      // drop expired
      queueRef.current = queueRef.current.filter((q) => q.expiresAt > now);

      if (!queueRef.current.length) return;

      const next = queueRef.current[0];
      const ok = playOnce(next.attackerSlot, next.targetSlot);

      if (!ok) {
        if (debug) {
          window.__bb_fx_lastFail = {
            reason: 'scheduler_cannot_play_yet',
            from: next.attackerSlot,
            to: next.targetSlot,
            dom: window.__bb_fx_domCount ?? null,
            reg: window.__bb_fx_regCount ?? null,
            cacheKeys: Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 10),
            queueLen: queueRef.current.length,
          };
          // eslint-disable-next-line no-console
          console.warn('[BB FX] scheduler cannot play yet', window.__bb_fx_lastFail);
        }
        return;
      }

      // success consume
      queueRef.current.shift();
      playingUntilRef.current = now + FX_DURATION_MS + FX_GAP_MS;
      window.__bb_fx_queueLen = queueRef.current.length;
      window.__bb_fx_queue = queueRef.current.slice();
      setQueueLenState(queueRef.current.length);

      if (debug) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] scheduler played', { from: next.attackerSlot, to: next.targetSlot, queueLen: queueRef.current.length });
      }
    }, TICK_MS);

    return () => window.clearInterval(t);
  }, [debug]); // eslint-disable-line react-hooks/exhaustive-deps

  // attackLike
  const attackLike = useMemo(() => {
    const out: FxEvent[] = [];
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.attackerId === 'string' && typeof e.targetId === 'string') out.push(e);
    }
    return out;
  }, [events]);

  // ENQUEUE DELTA — GLOBAL LEN (this was missing in your v22)
  useEffect(() => {
    const w = window as any;
    const currLen = attackLike.length;
    const prevLen = typeof w.__bb_fx_lastAttackLikeLen === 'number' ? w.__bb_fx_lastAttackLikeLen : 0;

    // Always mark that effect ran
    w.__bb_fx_lastEnqueue = { ran: true, prevLen, currLen, queueLen: queueRef.current.length };
    w.__bb_fx_lastAttackLikeLen = currLen;

    if (currLen <= prevLen) return;

    for (let idx = prevLen; idx < currLen; idx++) {
      const e = attackLike[idx];
      if (!e || typeof e !== 'object') continue;

      const attackerSlot = e.attackerSlot || extractSlotKey(String(e.attackerId ?? ''));
      const targetSlot = e.targetSlot || extractSlotKey(String(e.targetId ?? ''));

      if (!attackerSlot || !targetSlot) {
        if (debug) {
          window.__bb_fx_lastFail = { reason: 'cannot_extract_slot', idx, attackerId: e.attackerId, targetId: e.targetId };
          // eslint-disable-next-line no-console
          console.warn('[BB FX] cannot extract slot', window.__bb_fx_lastFail);
        }
        continue;
      }

      const now = Date.now();
      const q = {
        k: `${idx}:${String(e.type ?? '')}:${String(e.attackerId ?? '')}>${String(e.targetId ?? '')}`,
        attackerSlot,
        targetSlot,
        createdAt: now,
        expiresAt: now + FX_WINDOW_MS,
        type: String(e.type ?? ''),
        idx,
      };

      queueRef.current.push(q);
      window.__bb_fx_queue = queueRef.current.slice();
      window.__bb_fx_queueLen = queueRef.current.length;
      setQueueLenState(queueRef.current.length);

      w.__bb_fx_lastEnqueue = { idx, from: attackerSlot, to: targetSlot, queueLen: queueRef.current.length, prevLen, currLen };
      if (debug) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] enqueued(delta)', w.__bb_fx_lastEnqueue);
      }
    }
  }, [attackLike.length, debug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debug helpers
  useEffect(() => {
    window.__bb_fx_ping = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const b = document.createElement('div');
      b.style.position = 'fixed';
      b.style.left = '12px';
      b.style.top = '12px';
      b.style.width = '26px';
      b.style.height = '26px';
      b.style.borderRadius = '8px';
      b.style.background = 'rgba(255,0,170,0.95)';
      b.style.boxShadow = '0 0 18px rgba(255,0,170,0.75)';
      b.style.zIndex = '2147483647';
      b.style.pointerEvents = 'none';
      overlay.appendChild(b);
      window.setTimeout(() => {
        try {
          b.remove();
        } catch {}
      }, 700);
    };
    window.__bb_fx_testFly = (fromSlot: string, toSlot: string) => playOnce(fromSlot, toSlot);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const overlayNode = (
    <>
      <div
        ref={overlayRef}
        data-bb-fx-root="1"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '100vw',
          height: '100vh',
          pointerEvents: 'none',
          zIndex: 2147483000,
        }}
      />
      {debug ? (
        <div
          className="bb-fx-debug"
          style={{
            position: 'fixed',
            left: 12,
            top: 50,
            maxWidth: 760,
            padding: 10,
            borderRadius: 12,
            background: 'rgba(0,0,0,.45)',
            color: 'white',
            fontSize: 12,
            zIndex: 2147483646,
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
          }}
        >
          {'FX debug\n'}
          {`build: ${window.__bb_fx_build || 'n/a'}\n`}
          {`events: ${events.length}\n`}
          {`attackLike: ${attackLike.length}\n`}
          {`domSlots: ${window.__bb_fx_domCount ?? 'n/a'}\n`}
          {`registrySlots: ${window.__bb_fx_regCount ?? 'n/a'}\n`}
          {`cacheKeys: ${Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 10).join(',')}\n`}
          {`laneCenters: ${laneCenters ? 'yes' : 'no'}\n`}
          {`lastAttackLikeLen: ${window.__bb_fx_lastAttackLikeLen ?? 'n/a'}\n`}
          {`lastEnqueue: ${window.__bb_fx_lastEnqueue ? 'yes' : 'no'}\n`}
          {`queueLen: ${queueLenState} (win=${window.__bb_fx_queueLen ?? 0})\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
          {`ping: window.__bb_fx_ping()\n`}
          {`lastFail: window.__bb_fx_lastFail\n`}
        </div>
      ) : null}
    </>
  );

  if (!mounted || !portalRootRef.current) return null;
  return createPortal(overlayNode, portalRootRef.current);
}
