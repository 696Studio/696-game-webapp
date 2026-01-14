'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// Build stamp for debugging: proves the client module executed
if (typeof window !== 'undefined') {
  (window as any).__bb_fx_build = 'BattleFxLayer.registry.fixed.v2';
  // Stub until component mounts
  if (!(window as any).__bb_fx_testFly) {
    (window as any).__bb_fx_testFly = () => {
      console.warn('[BB FX] __bb_fx_testFly not ready (component not mounted yet)');
      return false;
    };
  }
}

type FxEvent =
  | {
      type: 'atk';
      attackerId: string;
      targetId: string;
      ts?: number;
      attackerSlot?: string;
      targetSlot?: string;
    }
  | { type: string; [k: string]: any };

function extractSlotKey(id: string): string | null {
  // Expected formats (examples):
  // matchId:round:p1:3:cardId:unitInstanceId
  // p2:1:unitInstanceId
  // ...:p1:0:...
  if (!id) return null;

  // fast path: already "p1:3"
  const direct = id.match(/\b(p1|p2):([0-4])\b/);
  if (direct) return `${direct[1]}:${direct[2]}`;

  // generic path: find "...:p1:3:..."
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
  return document.querySelector(`[data-bb-slot="${CSS.escape(slotKey)}"]`) as HTMLElement | null;
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

  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  const atkEvents = useMemo(() => events.filter((e) => (e as any)?.type === 'atk') as FxEvent[], [events]);

  // poll localStorage toggle (Telegram WebView sometimes ignores storage event)
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        setDebug(localStorage.getItem('bb_fx_debug') === '1');
      } catch {}
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  const flyBetween = (fromEl: HTMLElement, toEl: HTMLElement) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const from = centerOf(fromEl);
    const to = centerOf(toEl);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Clone attacker visual (best-effort). If slot is empty, clone might be tiny; that's fine.
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
      {
        duration: 420,
        easing: 'cubic-bezier(.2,.8,.2,1)',
        fill: 'forwards',
      }
    );

    anim.onfinish = () => {
      try {
        clone.remove();
      } catch {}
    };

    return true;
  };

  // Expose manual hooks in debug mode
  useEffect(() => {
    if (!debug) return;

    (window as any).__bb_fx_registryCount = slotRegistryRef?.current
      ? Object.values(slotRegistryRef.current).filter((el) => !!el).length
      : 0;

    (window as any).__bb_fx_testFly = (fromSlot: string, toSlot: string) => {
      const reg = slotRegistryRef?.current || {};
      const fromEl = reg[fromSlot] || findSlotEl(fromSlot);
      const toEl = reg[toSlot] || findSlotEl(toSlot);
      if (!fromEl || !toEl) {
        // eslint-disable-next-line no-console
        console.warn('[BB FX] testFly cannot resolve', {
          fromSlot,
          toSlot,
          fromFound: !!fromEl,
          toFound: !!toEl,
        });
        return false;
      }
      return flyBetween(fromEl, toEl);
    };
  }, [debug, slotRegistryRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play on latest atk event
  useEffect(() => {
    if (!atkEvents.length) return;

    const last = atkEvents[atkEvents.length - 1] as any;
    if (!last || typeof last !== 'object') return;

    const key = `${String(last.ts ?? '')}:${String(last.attackerId ?? '')}>${String(last.targetId ?? '')}`;
    if (key === lastSeenRef.current) return;
    lastSeenRef.current = key;

    const attackerSlot: string | null =
      last.attackerSlot || extractSlotKey(String(last.attackerId ?? ''));
    const targetSlot: string | null =
      last.targetSlot || extractSlotKey(String(last.targetId ?? ''));

    if (!attackerSlot || !targetSlot) {
      if (debug) {
        (window as any).__bb_fx_lastFail = {
          reason: 'cannot_extract_slot',
          attackerId: last.attackerId,
          targetId: last.targetId,
          attackerSlot,
          targetSlot,
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot extract slot keys', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    const reg = slotRegistryRef?.current || {};
    const attackerEl = reg[attackerSlot] || findSlotEl(attackerSlot);
    const targetEl = reg[targetSlot] || findSlotEl(targetSlot);

    if (!attackerEl || !targetEl) {
      if (debug) {
        (window as any).__bb_fx_lastFail = {
          reason: 'cannot_resolve_dom',
          attackerId: last.attackerId,
          targetId: last.targetId,
          attackerSlot,
          targetSlot,
          attackerFound: !!attackerEl,
          targetFound: !!targetEl,
          domSlotCountRegistry: slotRegistryRef?.current
            ? Object.values(slotRegistryRef.current).filter((el) => !!el).length
            : 0,
          domSlotCountQuery: document.querySelectorAll('[data-bb-slot]').length,
          domSlotsSample: Array.from(document.querySelectorAll('[data-bb-slot]'))
            .slice(0, 12)
            .map((n) => (n as HTMLElement).getAttribute('data-bb-slot')),
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot resolve DOM for slots', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    flyBetween(attackerEl, targetEl);
  }, [atkEvents, debug, slotRegistryRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const registryCount = slotRegistryRef?.current ? Object.values(slotRegistryRef.current).filter((el) => !!el).length : 0;

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
            maxWidth: 520,
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
          {`events: ${events.length}\n`}
          {`atkEvents: ${atkEvents.length}\n`}
          {`domSlots: ${document.querySelectorAll('[data-bb-slot]').length}\n`}
          {`registrySlots: ${registryCount}\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
        </div>
      ) : null}
    </>
  );
}