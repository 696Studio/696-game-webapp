'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

if (typeof window !== 'undefined') {
  (window as any).__bb_fx_build = 'BattleFxLayer.registry.attackLike.v8';
  if (!(window as any).__bb_fx_testFly) {
    (window as any).__bb_fx_testFly = () => {
      // eslint-disable-next-line no-console
      console.warn('[BB FX] __bb_fx_testFly not ready (component not mounted yet)');
      return false;
    };
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
  const pendingRef = useRef<PendingAtk[]>([]);

  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  // Slot availability snapshots (IMPORTANT): DOM/refs can change without React state changes.
  const [slotSnap, setSlotSnap] = useState<{ dom: number; reg: number }>({ dom: 0, reg: 0 });

  // Poll localStorage toggle (Telegram WebView sometimes ignores storage event)
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

      (window as any).__bb_fx_domCount = dom;
      (window as any).__bb_fx_regCount = reg;
      (window as any).__bb_fx_pendingCount = pendingRef.current.length;
    }, 100);
    return () => window.clearInterval(t);
  }, [slotRegistryRef]);

  const slotsReady = slotSnap.dom > 0 || slotSnap.reg > 0;

  // Anything with attackerId+targetId is "attack-like"
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
    (window as any).__bb_fx_testFly = (fromSlot: string, toSlot: string) => {
      const ok = tryFly(fromSlot, toSlot);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] testFly cannot resolve', {
          fromSlot,
          toSlot,
          fromFound: !!resolveSlotEl(fromSlot),
          toFound: !!resolveSlotEl(toSlot),
          domSlotCountQuery: document.querySelectorAll('[data-bb-slot]').length,
          domSlotCountRegistry: slotRegistryRef?.current
            ? Object.values(slotRegistryRef.current).filter((el) => isUsableEl(el)).length
            : 0,
        });
      }
      return ok;
    };
  }, [slotRegistryRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending attacks when slots become available (state-driven)
  useEffect(() => {
    if (!slotsReady) return;

    const now = Date.now();
    pendingRef.current = pendingRef.current.filter((p) => now - p.createdAt < 5000);
    if (!pendingRef.current.length) return;

    let processed = 0;
    while (pendingRef.current.length && processed < 8) {
      const p = pendingRef.current.shift()!;
      const ok = tryFly(p.attackerSlot, p.targetSlot);

      if (debug && !ok) {
        (window as any).__bb_fx_lastFail = {
          reason: 'pending_fly_failed',
          idx: p.idx,
          type: p.type,
          attackerSlot: p.attackerSlot,
          targetSlot: p.targetSlot,
          domSlotCountRegistry: slotSnap.reg,
          domSlotCountQuery: slotSnap.dom,
          pendingCount: pendingRef.current.length,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] pending fly failed', (window as any).__bb_fx_lastFail);
        break;
      }

      processed += 1;
    }
  }, [slotsReady, slotSnap.dom, slotSnap.reg, debug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play on latest attack-like event
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
      (window as any).__bb_fx_lastAtk = last;
      (window as any).__bb_fx_atkCount = attackLike.length;
      // eslint-disable-next-line no-console
      console.debug('[BB FX] attack-like event', {
        idx,
        type: String(last.type ?? ''),
        attackerId: last.attackerId,
        targetId: last.targetId,
        attackerSlot,
        targetSlot,
        slotsReady,
        snap: slotSnap,
      });
    }

    if (!attackerSlot || !targetSlot) {
      if (debug) {
        (window as any).__bb_fx_lastFail = {
          reason: 'cannot_extract_slot',
          idx,
          type: String(last.type ?? ''),
          attackerId: last.attackerId,
          targetId: last.targetId,
          attackerSlot: attackerSlot || null,
          targetSlot: targetSlot || null,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot extract slot keys', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    // If slots not ready now, queue. Poller will flip slotSnap and flush.
    if (!slotsReady) {
      pendingRef.current.push({ idx, type: String(last.type ?? ''), attackerSlot, targetSlot, createdAt: Date.now() });

      if (debug) {
        (window as any).__bb_fx_lastFail = {
          reason: 'queued_waiting_for_slots',
          idx,
          type: String(last.type ?? ''),
          attackerSlot,
          targetSlot,
          domSlotCountRegistry: slotSnap.reg,
          domSlotCountQuery: slotSnap.dom,
          pendingCount: pendingRef.current.length,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] queued attack (slots not ready)', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    // Slots ready – try immediately; if fails, queue for flush.
    const ok = tryFly(attackerSlot, targetSlot);
    if (!ok) {
      pendingRef.current.push({ idx, type: String(last.type ?? ''), attackerSlot, targetSlot, createdAt: Date.now() });

      if (debug) {
        (window as any).__bb_fx_lastFail = {
          reason: 'queued_after_failed_immediate',
          idx,
          type: String(last.type ?? ''),
          attackerSlot,
          targetSlot,
          domSlotCountRegistry: slotSnap.reg,
          domSlotCountQuery: slotSnap.dom,
          pendingCount: pendingRef.current.length,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] immediate resolve failed; queued', (window as any).__bb_fx_lastFail);
      }
    }
  }, [attackLike, debug, slotsReady, slotSnap]); // eslint-disable-line react-hooks/exhaustive-deps

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
            maxWidth: 660,
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
          {`build: ${(typeof window !== 'undefined' && (window as any).__bb_fx_build) || 'n/a'}\n`}
          {`events: ${events.length}\n`}
          {`attackLike: ${attackLike.length}\n`}
          {`domSlots: ${slotSnap.dom}\n`}
          {`registrySlots: ${slotSnap.reg}\n`}
          {`slotsReady: ${slotsReady}\n`}
          {`pending: ${pendingRef.current.length}\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
          {`lastFail: window.__bb_fx_lastFail\n`}
          {`lastAtk: window.__bb_fx_lastAtk\n`}
        </div>
      ) : null}
    </>
  );
}
