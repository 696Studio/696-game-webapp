'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

// ===== Build stamp (module executed) =====
if (typeof window !== 'undefined') {
  (window as any).__bb_fx_build = 'BattleFxLayer.registry.attackLike.v6';
  if (!(window as any).__bb_fx_testFly) {
    (window as any).__bb_fx_testFly = () => {
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

function extractSlotKey(id: string): string | null {
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
  try {
    return document.querySelector(`[data-bb-slot="${CSS.escape(slotKey)}"]`) as HTMLElement | null;
  } catch {
    // CSS.escape might not exist in some older contexts, fallback
    return document.querySelector(`[data-bb-slot="${slotKey}"]`) as HTMLElement | null;
  }
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

  // Telegram WebView sometimes ignores storage events
  useEffect(() => {
    const t = window.setInterval(() => {
      try {
        setDebug(localStorage.getItem('bb_fx_debug') === '1');
      } catch {}
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  // ===== Attack-like events: anything that has attackerId+targetId =====
  const attackLike = useMemo(() => {
    const out: FxEvent[] = [];
    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.attackerId === 'string' && typeof e.targetId === 'string') out.push(e);
    }
    return out;
  }, [events]);

  const registryCount = slotRegistryRef?.current
    ? Object.values(slotRegistryRef.current).filter((el) => !!el).length
    : 0;

  const flyBetween = (fromEl: HTMLElement, toEl: HTMLElement) => {
    const overlay = overlayRef.current;
    if (!overlay) return false;

    const from = centerOf(fromEl);
    const to = centerOf(toEl);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    // Best-effort clone of slot. If too heavy later we can replace with a sprite.
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

  const resolveSlotEl = (slotKey: string): HTMLElement | null => {
    const reg = slotRegistryRef?.current || {};
    return reg[slotKey] || findSlotEl(slotKey);
  };

  const waitForSlotsAndFly = (attackerSlot: string, targetSlot: string, idx: number, type: string) => {
    const maxFrames = 30; // ~0.5s at 60fps
    let frame = 0;

    const tick = () => {
      const domSlotCountQuery = document.querySelectorAll('[data-bb-slot]').length;
      const domSlotCountRegistry = slotRegistryRef?.current
        ? Object.values(slotRegistryRef.current).filter((el) => !!el).length
        : 0;

      const attackerEl = resolveSlotEl(attackerSlot);
      const targetEl = resolveSlotEl(targetSlot);

      if (attackerEl && targetEl) {
        const ok = flyBetween(attackerEl, targetEl);
        if (debug) {
          (window as any).__bb_fx_lastAtk = attackLike[idx];
          (window as any).__bb_fx_atkCount = attackLike.length;
          if (!ok) {
            (window as any).__bb_fx_lastFail = { reason: 'fly_failed', idx, type, attackerSlot, targetSlot };
            console.warn('[BB FX] flyBetween failed', (window as any).__bb_fx_lastFail);
          }
        }
        return;
      }

      if (frame >= maxFrames) {
        if (debug) {
          (window as any).__bb_fx_lastFail = {
            reason: 'slots_not_ready_or_missing',
            idx,
            type,
            attackerSlot,
            targetSlot,
            attackerFound: !!attackerEl,
            targetFound: !!targetEl,
            domSlotCountRegistry,
            domSlotCountQuery,
            domSlotsSample: Array.from(document.querySelectorAll('[data-bb-slot]'))
              .slice(0, 12)
              .map((n) => (n as HTMLElement).getAttribute('data-bb-slot')),
          };
          console.warn('[BB FX] cannot resolve DOM for slots (after retry)', (window as any).__bb_fx_lastFail);
        }
        return;
      }

      frame += 1;
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  // ===== Expose manual hooks (always) =====
  useEffect(() => {
    (window as any).__bb_fx_registryCount = slotRegistryRef?.current
      ? Object.values(slotRegistryRef.current).filter((el) => !!el).length
      : 0;

    (window as any).__bb_fx_testFly = (fromSlot: string, toSlot: string) => {
      const fromEl = resolveSlotEl(fromSlot);
      const toEl = resolveSlotEl(toSlot);
      if (!fromEl || !toEl) {
        console.warn('[BB FX] testFly cannot resolve', {
          fromSlot,
          toSlot,
          fromFound: !!fromEl,
          toFound: !!toEl,
          domSlotCountQuery: document.querySelectorAll('[data-bb-slot]').length,
          domSlotCountRegistry: (window as any).__bb_fx_registryCount,
        });
        return false;
      }
      return flyBetween(fromEl, toEl);
    };
  }, [slotRegistryRef, debug, attackLike.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== Play on latest attack-like event =====
  useEffect(() => {
    if (!attackLike.length) return;

    const idx = attackLike.length - 1;
    const last = attackLike[idx];
    if (!last || typeof last !== 'object') return;

    // Dedupe: include idx so we never collapse different attacks with missing ts
    const key = `${idx}:${String(last.type ?? '')}:${String(last.attackerId ?? '')}>${String(last.targetId ?? '')}`;
    if (key === lastSeenRef.current) return;
    lastSeenRef.current = key;

    const attackerSlot: string | null = last.attackerSlot || extractSlotKey(String(last.attackerId ?? ''));
    const targetSlot: string | null = last.targetSlot || extractSlotKey(String(last.targetId ?? ''));

    if (debug) {
      (window as any).__bb_fx_lastAtk = last;
      (window as any).__bb_fx_atkCount = attackLike.length;
      console.debug('[BB FX] attack-like event', {
        idx,
        type: String(last.type ?? ''),
        attackerId: last.attackerId,
        targetId: last.targetId,
        attackerSlot,
        targetSlot,
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
          attackerSlot,
          targetSlot,
        };
        console.warn('[BB FX] cannot extract slot keys', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    // Critical fix for your current failure: attacks can arrive BEFORE refs are populated.
    waitForSlotsAndFly(attackerSlot, targetSlot, idx, String(last.type ?? ''));
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
            maxWidth: 560,
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
          {`attackLike: ${attackLike.length}\n`}
          {`domSlots: ${document.querySelectorAll('[data-bb-slot]').length}\n`}
          {`registrySlots: ${registryCount}\n`}
          {`build: ${(typeof window !== 'undefined' && (window as any).__bb_fx_build) || 'n/a'}\n`}
          {`manual: window.__bb_fx_testFly('p1:0','p2:0')\n`}
          {`lastFail: window.__bb_fx_lastFail\n`}
          {`lastAtk: window.__bb_fx_lastAtk\n`}
        </div>
      ) : null}
    </>
  );
}
