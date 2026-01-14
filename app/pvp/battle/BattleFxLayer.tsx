'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    __bb_fx_build?: string;
    __bb_fx_testFly?: (from: string, to: string) => boolean;
    __bb_fx_ping?: () => void;

    __bb_fx_domCount?: number;
    __bb_fx_regCount?: number;

    __bb_fx_lastFail?: any;
    __bb_fx_lastAtk?: any;
    __bb_fx_atkCount?: number;

    __bb_fx_pending?: any[];
    __bb_fx_pendingCount?: number;

    __bb_fx_slotCenters?: Record<string, { x: number; y: number; w: number; h: number; t: number }>;
  }
}

if (typeof window !== 'undefined') {
  window.__bb_fx_build = 'BattleFxLayer.registry.portal.v11';
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

function isUsableEl(el: HTMLElement | null | undefined): el is HTMLElement {
  return !!el && !!(el as any).isConnected;
}

function safeQuerySlot(slotKey: string): HTMLElement | null {
  try {
    return document.querySelector(`[data-bb-slot="${CSS.escape(slotKey)}"]`) as HTMLElement | null;
  } catch {
    return document.querySelector(`[data-bb-slot="${slotKey}"]`) as HTMLElement | null;
  }
}

// Create a portal root on <body> so it's NEVER clipped by app containers / transforms
function ensurePortalRoot(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const id = 'bb-fx-portal-root';
  let el = document.getElementById(id) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  // Always enforce styles (in case of hot reload)
  el.style.position = 'fixed';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = '100vw';
  el.style.height = '100vh';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2147483646'; // near max
  return el;
}

export default function BattleFxLayer({
  events,
  slotRegistryRef,
}: {
  events: FxEvent[];
  slotRegistryRef?: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  const portalRef = useRef<HTMLDivElement | null>(null);
  const lastSeenRef = useRef<string>('');

  const pendingRef = useRef<PendingAtk[]>([]);
  const centersRef = useRef<Record<string, { x: number; y: number; w: number; h: number; t: number }>>(
    window.__bb_fx_slotCenters || {}
  );

  const syncPendingToWindow = () => {
    window.__bb_fx_pending = pendingRef.current.slice();
    window.__bb_fx_pendingCount = pendingRef.current.length;
  };
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

  // Create portal on mount
  useEffect(() => {
    portalRef.current = ensurePortalRoot();
    // Always expose a visible ping (to confirm portal is on top)
    window.__bb_fx_ping = () => {
      const root = portalRef.current || ensurePortalRoot();
      if (!root) return;

      const box = document.createElement('div');
      box.style.position = 'fixed';
      box.style.left = '24px';
      box.style.top = '70px';
      box.style.width = '28px';
      box.style.height = '28px';
      box.style.borderRadius = '10px';
      box.style.background = 'rgba(255, 0, 160, 0.95)';
      box.style.boxShadow = '0 0 24px rgba(255, 0, 160, 0.9)';
      box.style.zIndex = '2147483647';
      box.style.pointerEvents = 'none';
      root.appendChild(box);

      const anim = box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: 'linear', fill: 'forwards' });
      anim.onfinish = () => {
        try {
          box.remove();
        } catch {}
      };
    };

    // If debug is on, ping once so you immediately SEE the overlay exists
    try {
      if (localStorage.getItem('bb_fx_debug') === '1') window.__bb_fx_ping?.();
    } catch {}
  }, []);

  // Poll debug flag
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        setDebug(localStorage.getItem('bb_fx_debug') === '1');
      } catch {}
    }, 400);
    return () => window.clearInterval(t);
  }, []);

  // Fast scan loop: count slots + refresh centers cache
  useEffect(() => {
    let stop = false;

    const scan = () => {
      if (stop) return;

      const dom = document.querySelectorAll('[data-bb-slot]').length;

      const reg = slotRegistryRef?.current
        ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
        : 0;

      setSlotSnap((prev) => (prev.dom === dom && prev.reg === reg ? prev : { dom, reg }));
      window.__bb_fx_domCount = dom;
      window.__bb_fx_regCount = reg;

      // Refresh cached centers if DOM slots exist
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

      // Keep scanning very fast (rAF) for first 3 seconds, then slow interval
      requestAnimationFrame(scan);
    };

    // start immediate
    requestAnimationFrame(scan);

    // After 3 seconds, switch to interval to reduce cost (but keep accurate)
    const slow = window.setInterval(() => {
      const dom = document.querySelectorAll('[data-bb-slot]').length;
      const reg = slotRegistryRef?.current
        ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
        : 0;

      setSlotSnap((prev) => (prev.dom === dom && prev.reg === reg ? prev : { dom, reg }));
      window.__bb_fx_domCount = dom;
      window.__bb_fx_regCount = reg;

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
    }, 120);

    const stopFast = window.setTimeout(() => {
      stop = true;
    }, 3000);

    return () => {
      stop = true;
      window.clearInterval(slow);
      window.clearTimeout(stopFast);
    };
  }, [slotRegistryRef]);

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

    const qs = safeQuerySlot(slotKey);
    return isUsableEl(qs) ? qs : null;
  };

  const flyDotBetweenPoints = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const root = portalRef.current || ensurePortalRoot();
    if (!root) return false;

    const dot = document.createElement('div');
    dot.style.position = 'fixed';
    dot.style.left = `${from.x - 12}px`;
    dot.style.top = `${from.y - 12}px`;
    dot.style.width = '24px';
    dot.style.height = '24px';
    dot.style.borderRadius = '999px';
    dot.style.background = 'rgba(255, 0, 160, 0.95)';
    dot.style.boxShadow = '0 0 26px rgba(255, 0, 160, 0.9)';
    dot.style.pointerEvents = 'none';
    dot.style.zIndex = '2147483647';
    dot.style.willChange = 'transform, opacity';
    root.appendChild(dot);

    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const anim = dot.animate(
      [
        { transform: `translate3d(0px, 0px, 0px) scale(1)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px) scale(1)`, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px) scale(0.65)`, opacity: 0.0 },
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

  const tryFly = (attackerSlot: string, targetSlot: string) => {
    // 1) Live elements (registry or DOM)
    const attackerEl = resolveSlotEl(attackerSlot);
    const targetEl = resolveSlotEl(targetSlot);

    if (attackerEl && targetEl) {
      const ra = attackerEl.getBoundingClientRect();
      const rt = targetEl.getBoundingClientRect();
      const from = centerOfRect(ra);
      const to = centerOfRect(rt);
      return flyDotBetweenPoints({ x: from.x, y: from.y }, { x: to.x, y: to.y });
    }

    // 2) Cached centers (survive unmounts / rerenders)
    const a = centersRef.current[attackerSlot] || window.__bb_fx_slotCenters?.[attackerSlot];
    const b = centersRef.current[targetSlot] || window.__bb_fx_slotCenters?.[targetSlot];
    if (a && b) return flyDotBetweenPoints({ x: a.x, y: a.y }, { x: b.x, y: b.y });

    return false;
  };

  // Manual hook
  useEffect(() => {
    window.__bb_fx_testFly = (fromSlot: string, toSlot: string) => tryFly(fromSlot, toSlot);
  }, []);

  // Flush pending on any slot-snap change
  useEffect(() => {
    const now = Date.now();
    pendingRef.current = pendingRef.current.filter((p) => now - p.createdAt < 9000);
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

      if (debug) {
        window.__bb_fx_lastFail = {
          reason: 'pending_still_cannot_fly',
          idx: p.idx,
          type: p.type,
          attackerSlot: p.attackerSlot,
          targetSlot: p.targetSlot,
          dom: slotSnap.dom,
          reg: slotSnap.reg,
          cacheKeys: Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 12),
          pendingCount: pendingRef.current.length,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] pending still cannot fly', window.__bb_fx_lastFail);
      }
      break;
    }
  }, [slotSnap.dom, slotSnap.reg, debug]);

  // Enqueue latest attack-like event
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

    window.__bb_fx_lastAtk = last;
    window.__bb_fx_atkCount = attackLike.length;

    if (!attackerSlot || !targetSlot) {
      window.__bb_fx_lastFail = {
        reason: 'cannot_extract_slot',
        idx,
        type: last.type,
        attackerId: last.attackerId,
        targetId: last.targetId,
      };
      if (debug) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot extract slot', window.__bb_fx_lastFail);
      }
      return;
    }

    // Try immediate; if fails — queue.
    const ok = tryFly(attackerSlot, targetSlot);
    if (ok) return;

    pendingRef.current.push({ idx, type: String(last.type ?? ''), attackerSlot, targetSlot, createdAt: Date.now() });
    syncPendingToWindow();

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
    if (debug) {
      // eslint-disable-next-line no-console
      console.warn('[BB FX] enqueued (no live or cache yet)', window.__bb_fx_lastFail);
    }
  }, [attackLike, debug]); // eslint-disable-line react-hooks/exhaustive-deps

  return debug ? (
    <div
      className="bb-fx-debug"
      style={{
        position: 'fixed',
        left: 12,
        top: 12,
        maxWidth: 820,
        padding: 10,
        borderRadius: 12,
        background: 'rgba(0,0,0,.45)',
        color: 'white',
        fontSize: 12,
        zIndex: 2147483647,
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
      {`pending: ${pendingRef.current.length} (win=${window.__bb_fx_pending?.length || 0})\n`}
      {`cacheKeys: ${Object.keys(window.__bb_fx_slotCenters || {}).slice(0, 10).join(',')}\n`}
      {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
      {`ping: window.__bb_fx_ping()\n`}
      {`lastFail: window.__bb_fx_lastFail\n`}
      {`lastAtk: window.__bb_fx_lastAtk\n`}
    </div>
  ) : null;
}
