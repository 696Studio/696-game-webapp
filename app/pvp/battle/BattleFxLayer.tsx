'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    __bb_fx_build?: string;
    __bb_fx_testFly?: (from: string, to: string) => boolean;

    __bb_fx_domCount?: number;
    __bb_fx_regCount?: number;

    __bb_fx_lastFail?: any;
    __bb_fx_lastAtk?: any;
    __bb_fx_atkCount?: number;

    __bb_fx_pending?: any[];
    __bb_fx_pendingCount?: number;

    // Cached slot centers in viewport coords (persist across unmounts)
    __bb_fx_slotCenters?: Record<string, { x: number; y: number; w: number; h: number; t: number }>;
  }
}

if (typeof window !== 'undefined') {
  window.__bb_fx_build = 'BattleFxLayer.registry.attackLike.v10';
  if (!window.__bb_fx_testFly) {
    window.__bb_fx_testFly = () => {
      // eslint-disable-next-line no-console
      console.warn('[BB FX] __bb_fx_testFly not ready (component not mounted yet)');
      return false;
    };
  }
  if (!Array.isArray(window.__bb_fx_pending)) window.__bb_fx_pending = [];
  if (!window.__bb_fx_slotCenters) window.__bb_fx_slotCenters = {};
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

type PendingAtk = {
  idx: number;
  type: string;
  attackerSlot: string;
  targetSlot: string;
  createdAt: number;
};

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

function centerOfRect(r: DOMRect) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

function findSlotEl(slotKey: string): HTMLElement | null {
  try {
    return document.querySelector(`[data-bb-slot="${CSS.escape(slotKey)}"]`) as HTMLElement | null;
  } catch {
    return document.querySelector(`[data-bb-slot="${slotKey}"]`) as HTMLElement | null;
  }
}

function isUsableEl(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && !!(el as any).isConnected;
}

export default function BattleFxLayer({
  events,
  slotRegistryRef,
}: {
  events: FxEvent[];
  slotRegistryRef?: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const lastSeenRef = useRef<string>('');

  const pendingRef = useRef<PendingAtk[]>([]);
  const syncPendingToWindow = () => {
    window.__bb_fx_pending = pendingRef.current.slice();
    window.__bb_fx_pendingCount = pendingRef.current.length;
  };

  const centersRef = useRef<Record<string, { x: number; y: number; w: number; h: number; t: number }>>(
    window.__bb_fx_slotCenters || {}
  );
  const syncCentersToWindow = () => {
    window.__bb_fx_slotCenters = centersRef.current;
  };

  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  const [slotSnap, setSlotSnap] = useState<{ dom: number; reg: number }>({ dom: 0, reg: 0 });

  // Adopt pending from window on mount (survive remounts)
  useEffect(() => {
    const fromWin = Array.isArray(window.__bb_fx_pending) ? (window.__bb_fx_pending as PendingAtk[]) : [];
    pendingRef.current = fromWin.filter(Boolean);
    syncPendingToWindow();
  }, []);

  // Poll debug flag
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        setDebug(localStorage.getItem('bb_fx_debug') === '1');
      } catch {}
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // Poll DOM + registry counts and refresh slot center cache
  useEffect(() => {
    const t = window.setInterval(() => {
      const dom = document.querySelectorAll('[data-bb-slot]').length;
      const reg = slotRegistryRef?.current
        ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
        : 0;

      setSlotSnap((prev) => (prev.dom === dom && prev.reg === reg ? prev : { dom, reg }));
      window.__bb_fx_domCount = dom;
      window.__bb_fx_regCount = reg;

      // Refresh centers cache whenever slots exist
      if (dom > 0) {
        const now = Date.now();
        const nodes = Array.from(document.querySelectorAll('[data-bb-slot]')) as HTMLElement[];
        for (const el of nodes) {
          const k = el.getAttribute('data-bb-slot');
          if (!k) continue;
          const r = el.getBoundingClientRect();
          const c = centerOfRect(r);
          centersRef.current[k] = { x: c.x, y: c.y, w: c.w, h: c.h, t: now };
        }
        syncCentersToWindow();
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [slotRegistryRef]);

  const slotsReady = slotSnap.dom > 0 || slotSnap.reg > 0;

  // attack-like: anything that has attackerId+targetId
  const attackLike = useMemo(() => {
    const out: FxEvent[] = [];
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.attackerId === 'string' && typeof e.targetId === 'string') out.push(e);
    }
    return out;
  }, [events]);

  const resolveSlotEl = (slotKey: string): HTMLElement | null => {
    const reg = slotRegistryRef?.current || {};
    const el = reg[slotKey];
    if (isUsableEl(el)) return el;
    const qs = findSlotEl(slotKey);
    return isUsableEl(qs) ? qs : null;
  };

  const flyDotBetweenPoints = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const dot = document.createElement('div');
    dot.style.position = 'fixed';
    dot.style.left = `${from.x - 10}px`;
    dot.style.top = `${from.y - 10}px`;
    dot.style.width = '20px';
    dot.style.height = '20px';
    dot.style.borderRadius = '999px';
    dot.style.background = 'rgba(255,255,255,0.95)';
    dot.style.boxShadow = '0 0 18px rgba(255,255,255,0.75)';
    dot.style.pointerEvents = 'none';
    dot.style.zIndex = '999999';
    dot.style.willChange = 'transform, opacity';
    overlay.appendChild(dot);

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const anim = dot.animate(
      [
        { transform: `translate3d(0px, 0px, 0px)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, opacity: 0.0 },
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );

    anim.onfinish = () => {
      try {
        dot.remove();
      } catch {}
    };

    return true;
  };

  const flyBetweenEls = (fromEl: HTMLElement, toEl: HTMLElement) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const rf = fromEl.getBoundingClientRect();
    const rt = toEl.getBoundingClientRect();
    const from = centerOfRect(rf);
    const to = centerOfRect(rt);

    const clone = fromEl.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = `${rf.left}px`;
    clone.style.top = `${rf.top}px`;
    clone.style.width = `${rf.width}px`;
    clone.style.height = `${rf.height}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '999999';
    clone.style.willChange = 'transform, opacity';
    clone.style.transform = 'translate3d(0,0,0)';

    overlay.appendChild(clone);

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const anim = clone.animate(
      [
        { transform: `translate3d(0px, 0px, 0px)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, opacity: 1 },
        { transform: `translate3d(${dx * 0.2}px, ${dy * 0.2}px, 0px)`, opacity: 1 },
        { transform: `translate3d(0px, 0px, 0px)`, opacity: 0.0 },
      ],
      { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }
    );

    anim.onfinish = () => {
      try {
        clone.remove();
      } catch {}
    };

    return true;
  };

  const tryFly = (attackerSlot: string, targetSlot: string) => {
    // First try live DOM/registry
    const attackerEl = resolveSlotEl(attackerSlot);
    const targetEl = resolveSlotEl(targetSlot);
    if (attackerEl && targetEl) return flyBetweenEls(attackerEl, targetEl);

    // Fallback to cached centers (survive unmounts)
    const a = centersRef.current[attackerSlot] || window.__bb_fx_slotCenters?.[attackerSlot];
    const b = centersRef.current[targetSlot] || window.__bb_fx_slotCenters?.[targetSlot];
    if (a && b) return flyDotBetweenPoints({ x: a.x, y: a.y }, { x: b.x, y: b.y });

    return false;
  };

  // Manual hook always available
  useEffect(() => {
    window.__bb_fx_testFly = (fromSlot: string, toSlot: string) => tryFly(fromSlot, toSlot);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending whenever we can (even if slotsReady is false, cache might exist)
  useEffect(() => {
    const now = Date.now();
    pendingRef.current = pendingRef.current.filter((p) => now - p.createdAt < 8000);
    syncPendingToWindow();

    if (!pendingRef.current.length) return;

    let processed = 0;
    while (pendingRef.current.length && processed < 10) {
      const p = pendingRef.current[0];
      const ok = tryFly(p.attackerSlot, p.targetSlot);

      if (ok) {
        pendingRef.current.shift();
        processed += 1;
        syncPendingToWindow();
        if (debug) {
          // eslint-disable-next-line no-console
          console.debug('[BB FX] flushed pending', { idx: p.idx, from: p.attackerSlot, to: p.targetSlot });
        }
        continue;
      }

      // Still cannot fly – stop and keep it queued
      if (debug) {
        window.__bb_fx_lastFail = {
          reason: 'pending_still_cannot_fly',
          idx: p.idx,
          type: p.type,
          attackerSlot: p.attackerSlot,
          targetSlot: p.targetSlot,
          dom: slotSnap.dom,
          reg: slotSnap.reg,
          hasCacheA: !!(centersRef.current[p.attackerSlot] || window.__bb_fx_slotCenters?.[p.attackerSlot]),
          hasCacheB: !!(centersRef.current[p.targetSlot] || window.__bb_fx_slotCenters?.[p.targetSlot]),
          pendingCount: pendingRef.current.length,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] pending still cannot fly', window.__bb_fx_lastFail);
      }
      break;
    }
  }, [slotSnap.dom, slotSnap.reg, debug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Enqueue on latest attack-like event
  useEffect(() => {
    if (!attackLike.length) return;

    const idx = attackLike.length - 1;
    const last = attackLike[idx];
    if (!last || typeof last !== 'object') return;

    const key = `${idx}:${String(last.type ?? '')}:${String(last.attackerId ?? '')}>${String(last.targetId ?? '')}`;
    if (key === lastSeenRef.current) return;
    lastSeenRef.current = key;

    const attackerSlot = (last.attackerSlot || extractSlotKey(String(last.attackerId ?? ''))) ?? '';
    const targetSlot = (last.targetSlot || extractSlotKey(String(last.targetId ?? ''))) ?? '';

    if (debug) {
      window.__bb_fx_lastAtk = last;
      window.__bb_fx_atkCount = attackLike.length;
      // eslint-disable-next-line no-console
      console.debug('[BB FX] attack-like event', { idx, type: last.type, attackerSlot, targetSlot, slotsReady, snap: slotSnap });
    }

    if (!attackerSlot || !targetSlot) {
      if (debug) {
        window.__bb_fx_lastFail = { reason: 'cannot_extract_slot', idx, type: last.type, attackerId: last.attackerId, targetId: last.targetId };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot extract slot', window.__bb_fx_lastFail);
      }
      return;
    }

    // Try immediate (live or cache). If fails, enqueue.
    const immediate = tryFly(attackerSlot, targetSlot);
    if (immediate) return;

    pendingRef.current.push({ idx, type: String(last.type ?? ''), attackerSlot, targetSlot, createdAt: Date.now() });
    syncPendingToWindow();

    if (debug) {
      window.__bb_fx_lastFail = {
        reason: 'enqueued_no_live_or_cache',
        idx,
        type: String(last.type ?? ''),
        attackerSlot,
        targetSlot,
        dom: slotSnap.dom,
        reg: slotSnap.reg,
        cacheKeys: Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 12),
        pendingCount: pendingRef.current.length,
      };
      // eslint-disable-next-line no-console
      console.warn('[BB FX] enqueued (no live or cache yet)', window.__bb_fx_lastFail);
    }
  }, [attackLike, debug]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
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
          zIndex: 999998,
        }}
      />
      {debug ? (
        <div
          className="bb-fx-debug"
          style={{
            position: 'fixed',
            left: 12,
            top: 12,
            maxWidth: 760,
            padding: 10,
            borderRadius: 12,
            background: 'rgba(0,0,0,.45)',
            color: 'white',
            fontSize: 12,
            zIndex: 1000000,
            pointerEvents: 'none',
            whiteSpace: 'pre-wrap',
          }}
        >
          {'FX debug\n'}
          {`toggle: localStorage.bb_fx_debug='1'\n`}
          {`build: ${window.__bb_fx_build || 'n/a'}\n`}
          {`events: ${events.length}\n`}
          {`attackLike: ${attackLike.length}\n`}
          {`domSlots: ${slotSnap.dom}\n`}
          {`registrySlots: ${slotSnap.reg}\n`}
          {`slotsReady: ${slotsReady}\n`}
          {`pending: ${pendingRef.current.length} (win=${window.__bb_fx_pending?.length || 0})\n`}
          {`cacheKeys: ${Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 10).join(',')}\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
          {`lastFail: window.__bb_fx_lastFail\n`}
          {`lastAtk: window.__bb_fx_lastAtk\n`}
        </div>
      ) : null}
    </>
  );
}
