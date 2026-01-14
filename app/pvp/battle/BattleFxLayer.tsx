'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type FxEvent =
  | {
      type: 'atk';
      attackerId: string;
      targetId: string;
      ts?: number;
    }
  | { type: string; [k: string]: any };

function extractSlotKey(id: string): string | null {
  // composite format example:
  // matchId:round:p1:3:unitId:unitInstanceId
  const m = id.match(/:(p[12]):([0-4]):/);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

function getCandidateDocs(): Document[] {
  const docs: Document[] = [document];
  const iframes = Array.from(document.querySelectorAll('iframe'));
  for (const fr of iframes) {
    try {
      const d = fr.contentDocument;
      if (d) docs.push(d);
    } catch {
      // cross-origin iframe - ignore
    }
  }
  return docs;
}

function findSlotEl(slotKey: string): HTMLElement | null {
  for (const d of getCandidateDocs()) {
    const el = d.querySelector(`[data-bb-slot="${slotKey}"]`);
    if (el && el instanceof HTMLElement) return el;
  }
  // fallback: try to match by id tail (some builds used id=composite)
  const [side, idx] = slotKey.split(':');
  const tail = `:${side}:${idx}:`;
  for (const d of getCandidateDocs()) {
    const any = Array.from(d.querySelectorAll('[id]')).find((n) => {
      const id = (n as HTMLElement).id || '';
      return id.includes(tail);
    });
    if (any && any instanceof HTMLElement) return any;
  }
  return null;
}

function centerOf(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export default function BattleFxLayer({
  events,
}: {
  events: FxEvent[];
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const lastSeenRef = useRef<number>(0);
  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem('bb_fx_debug') === '1';
    } catch {
      return false;
    }
  });

  const atkEvents = useMemo(() => events.filter((e) => e?.type === 'atk') as FxEvent[], [events]);

  useEffect(() => {
    // allow toggle via localStorage + reload
    const t = window.setInterval(() => {
      try {
        const v = localStorage.getItem('bb_fx_debug') === '1';
        setDebug(v);
      } catch {}
    }, 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const last = atkEvents[atkEvents.length - 1] as any;
    if (!last || typeof last !== 'object') return;

    // ensure we only play once per new event
    const key = (last.ts ?? 0) + ':' + last.attackerId + '>' + last.targetId;
    const keyHash = key.length;
    if (keyHash === lastSeenRef.current) return;
    lastSeenRef.current = keyHash;

    const attackerSlot = extractSlotKey(last.attackerId);
    const targetSlot = extractSlotKey(last.targetId);

    if (!attackerSlot || !targetSlot) return;

    // Resolve dom
    const attackerEl = findSlotEl(attackerSlot);
    const targetEl = findSlotEl(targetSlot);

    if (!attackerEl || !targetEl) {
      if (debug) {
        (window as any).__bb_fx_lastFail = {
          attackerId: last.attackerId,
          targetId: last.targetId,
          attackerSlot,
          targetSlot,
          attackerFound: !!attackerEl,
          targetFound: !!targetEl,
          domUnitCount: document.querySelectorAll('[id]').length,
          domSlotCount: document.querySelectorAll('[data-bb-slot]').length,
          domIdsSample: Array.from(document.querySelectorAll('[id]'))
            .slice(0, 12)
            .map((n) => (n as HTMLElement).id),
          domSlotsSample: Array.from(document.querySelectorAll('[data-bb-slot]'))
            .slice(0, 12)
            .map((n) => (n as HTMLElement).getAttribute('data-bb-slot')),
        };
        // eslint-disable-next-line no-console
        console.warn('[BB FX] cannot resolve DOM', (window as any).__bb_fx_lastFail);
      }
      return;
    }

    // Build flying clone
    const aRect = attackerEl.getBoundingClientRect();
    const clone = attackerEl.cloneNode(true) as HTMLElement;
    clone.style.position = 'fixed';
    clone.style.left = `${aRect.left}px`;
    clone.style.top = `${aRect.top}px`;
    clone.style.width = `${aRect.width}px`;
    clone.style.height = `${aRect.height}px`;
    clone.style.margin = '0';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '999999';
    clone.style.willChange = 'transform';
    clone.style.transform = 'translate3d(0,0,0)';
    overlay.appendChild(clone);

    const from = centerOf(attackerEl);
    const to = centerOf(targetEl);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    const anim = clone.animate(
      [
        { transform: `translate3d(0px, 0px, 0px)` },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)` },
        { transform: `translate3d(0px, 0px, 0px)` },
      ],
      {
        duration: 520,
        easing: 'cubic-bezier(.2,.9,.2,1)',
      }
    );

    anim.onfinish = () => {
      try {
        overlay.removeChild(clone);
      } catch {}
    };

    return () => {
      try {
        anim.cancel();
      } catch {}
      try {
        overlay.removeChild(clone);
      } catch {}
    };
  }, [atkEvents, debug]);

  return (
    <>
      <div
        ref={overlayRef}
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 999999,
        }}
      />
      {debug ? (
        <div
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
          {`dom: ${document.querySelectorAll('[id]').length} ids / ${document.querySelectorAll('[data-bb-slot]').length} slots\n`}
        </div>
      ) : null}
    </>
  );
}
