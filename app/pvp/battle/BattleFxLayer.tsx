'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

declare global {
  interface Window {
    __bb_fx_build?: string;
    __bb_fx_testFly?: (from: string, to: string) => boolean;
    __bb_fx_pending?: any[];
    __bb_fx_lastFail?: any;
    __bb_fx_lastAtk?: any;
    __bb_fx_atkCount?: number;
    __bb_fx_domCount?: number;
    __bb_fx_regCount?: number;
    __bb_fx_pendingCount?: number;
  }
}

if (typeof window !== 'undefined') {
  window.__bb_fx_build = 'BattleFxLayer.registry.attackLike.v9';
  if (!window.__bb_fx_testFly) {
    window.__bb_fx_testFly = () => {
      // eslint-disable-next-line no-console
      console.warn('[BB FX] __bb_fx_testFly not ready (component not mounted yet)');
      return false;
    };
  }
  if (!Array.isArray(window.__bb_fx_pending)) window.__bb_fx_pending = [];
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

function centerOf(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
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

  // Local pending, but mirrored to window.__bb_fx_pending to survive unmount/remount
  const pendingRef = useRef<PendingAtk[]>([]);
  const syncPendingToWindow = () => {
    if (typeof window === 'undefined') return;
    window.__bb_fx_pending = pendingRef.current.slice();
    window.__bb_fx_pendingCount = pendingRef.current.length;
  };

  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  const [slotSnap, setSlotSnap] = useState<{ dom: number; reg: number }>({ dom: 0, reg: 0 });

  // On mount: adopt pending from window
  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  // Poll DOM + registry counts so we can flush queued attacks WHEN slots appear.
  useEffect(() => {
    const t = window.setInterval(() => {
      const dom = document.querySelectorAll('[data-bb-slot]').length;
      const reg = slotRegistryRef?.current
        ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
        : 0;

      setSlotSnap((prev) => (prev.dom === dom && prev.reg === reg ? prev : { dom, reg }));

      if (typeof window !== 'undefined') {
        window.__bb_fx_domCount = dom;
        window.__bb_fx_regCount = reg;
        window.__bb_fx_pendingCount = pendingRef.current.length;
      }
    }, 100);
    return () => window.clearInterval(t);
  }, [slotRegistryRef]);

  const slotsReady = slotSnap.dom > 0 || slotSnap.reg > 0;

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

  const flyBetween = (fromEl: HTMLElement, toEl: HTMLElement) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const from = centerOf(fromEl);
    const to = centerOf(toEl);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const clone = fromEl.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = `${from.rect.left}px`;
    clone.style.top = `${from.rect.top}px`;
    clone.style.width = `${from.rect.width}px`;
    clone.style.height = `${from.rect.height}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '999999';
    clone.style.willChange = 'transform, opacity';
    clone.style.transform = 'translate3d(0,0,0)';

    overlay.appendChild(clone);

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
    const attackerEl = resolveSlotEl(attackerSlot);
    const targetEl = resolveSlotEl(targetSlot);
    if (!attackerEl || !targetEl) return false;
    return flyBetween(attackerEl, targetEl);
  };

  // Manual hook always available
  useEffect(() => {
    window.__bb_fx_testFly = (fromSlot: string, toSlot: string) => {
      const ok = tryFly(fromSlot, toSlot);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] testFly cannot resolve', {
          fromSlot,
          toSlot,
          fromFound: !!resolveSlotEl(fromSlot),
          toFound: !!resolveSlotEl(toSlot),
          domSlots: document.querySelectorAll('[data-bb-slot]').length,
          regSlots: slotRegistryRef?.current
            ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
            : 0,
        });
      }
      return ok;
    };
  }, [slotRegistryRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending attacks when slots become available
  useEffect(() => {
    if (!slotsReady) return;

    const now = Date.now();
    pendingRef.current = pendingRef.current.filter((p) => now - p.createdAt < 8000);
    syncPendingToWindow();

    if (!pendingRef.current.length) return;

    let processed = 0;
    while (pendingRef.current.length && processed < 10) {
      const p = pendingRef.current.shift()!;
      const ok = tryFly(p.attackerSlot, p.targetSlot);

      if (debug) {
        if (ok) {
          // eslint-disable-next-line no-console
          console.debug('[BB FX] flushed pending attack', { idx: p.idx, type: p.type, from: p.attackerSlot, to: p.targetSlot });
        } else {
          window.__bb_fx_lastFail = {
            reason: 'pending_fly_failed',
            idx: p.idx,
            type: p.type,
            attackerSlot: p.attackerSlot,
            targetSlot: p.targetSlot,
            domSlotCountQuery: slotSnap.dom,
            domSlotCountRegistry: slotSnap.reg,
            pendingLeft: pendingRef.current.length,
          };
          // eslint-disable-next-line no-console
          console.warn('[BB FX] pending fly failed', window.__bb_fx_lastFail);
          // Put it back to the front for next time, and stop.
          pendingRef.current.unshift(p);
          break;
        }
      }

      processed += 1;
    }

    syncPendingToWindow();
  }, [slotsReady, slotSnap.dom, slotSnap.reg, debug]); // eslint-disable-line react-hooks/exhaustive-deps

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
      console.debug('[BB FX] attack-like event', {
        idx,
        type: String(last.type ?? ''),
        attackerSlot,
        targetSlot,
        slotsReady,
        snap: slotSnap,
      });
    }

    if (!attackerSlot || !targetSlot) {
      if (debug) {
        window.__bb_fx_lastFail = {
          reason: 'cannot_extract_slot',
          idx,
          type: String(last.type ?? ''),
          attackerId: last.attackerId,
          targetId: last.targetId,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot extract slot keys', window.__bb_fx_lastFail);
      }
      return;
    }

    // Always enqueue; flush effect will fire when slots are ready (even across unmounts).
    pendingRef.current.push({ idx, type: String(last.type ?? ''), attackerSlot, targetSlot, createdAt: Date.now() });
    syncPendingToWindow();

    if (debug) {
      window.__bb_fx_lastFail = {
        reason: slotsReady ? 'enqueued_slots_ready' : 'enqueued_slots_not_ready',
        idx,
        type: String(last.type ?? ''),
        attackerSlot,
        targetSlot,
        domSlotCountQuery: slotSnap.dom,
        domSlotCountRegistry: slotSnap.reg,
        pendingCount: pendingRef.current.length,
      };
      // eslint-disable-next-line no-console
      console.warn('[BB FX] enqueued attack', window.__bb_fx_lastFail);
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
            maxWidth: 720,
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
          {`build: ${(typeof window !== 'undefined' && window.__bb_fx_build) || 'n/a'}\n`}
          {`events: ${events.length}\n`}
          {`attackLike: ${attackLike.length}\n`}
          {`domSlots: ${slotSnap.dom}\n`}
          {`registrySlots: ${slotSnap.reg}\n`}
          {`slotsReady: ${slotsReady}\n`}
          {`pending(local): ${pendingRef.current.length}\n`}
          {`pending(window): ${(typeof window !== 'undefined' && Array.isArray(window.__bb_fx_pending) && window.__bb_fx_pending.length) || 0}\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
          {`lastFail: window.__bb_fx_lastFail\n`}
          {`lastAtk: window.__bb_fx_lastAtk\n`}
        </div>
      ) : null}
    </>
  );
}
