'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';

type AttackFxEvent = {
  type: 'attack';
  id: string;
  attackerId: string;
  targetId: string;
};

type Props = {
  events: AttackFxEvent[];
  debug?: boolean;
  // optional manual trigger from page debug panel (nonce changes => replay)
  debugAttack?: { attackerId?: string; targetId?: string; nonce?: number };
};

/**
 * BattleFxLayer
 * - Plays "attack fly" animations based on incoming attack events.
 * - Tries to animate the ORIGINAL attacker DOM element (not a clone).
 * - Locates DOM nodes via window.__bb_unitEls (preferred) or querySelector fallback.
 *
 * IMPORTANT: Must return a valid ReactNode (we render an optional tiny HUD).
 */
export default function BattleFxLayer({ events, debug = false, debugAttack }: Props) {
  const [mounted, setMounted] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const runningRef = useRef<boolean>(false);
  const queueRef = useRef<AttackFxEvent[]>([]);
  const lastHudRef = useRef<string>('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const debugEnabled = !!debug;

  const mergedEvents: AttackFxEvent[] = useMemo(() => {
    const base = Array.isArray(events) ? events : [];
    const nonce = debugAttack?.nonce ?? 0;
    const canManual =
      debugEnabled &&
      nonce &&
      (debugAttack?.attackerId ?? '') &&
      (debugAttack?.targetId ?? '');
    if (!canManual) return base;
    return [
      ...base,
      {
        type: 'attack',
        id: `dbg-${nonce}`,
        attackerId: String(debugAttack?.attackerId),
        targetId: String(debugAttack?.targetId),
      },
    ];
  }, [events, debugEnabled, debugAttack?.nonce, debugAttack?.attackerId, debugAttack?.targetId]);

  function getElByUnitId(unitId: string): HTMLElement | null {
    if (!unitId) return null;

    // Preferred: page.tsx should populate this map.
    const w = window as any;
    const map: Map<string, HTMLElement> | undefined = w.__bb_unitEls;
    if (map && typeof map.get === 'function') {
      const el = map.get(unitId);
      if (el && el instanceof HTMLElement) return el;
    }

    // Fallbacks:
    const sel1 = document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(unitId)}"]`);
    if (sel1) return sel1;

    // Some builds used other attrs
    const sel2 = document.querySelector<HTMLElement>(`[data-instance-id="${CSS.escape(unitId)}"]`);
    if (sel2) return sel2;

    return null;
  }

  function getCardEl(el: HTMLElement): HTMLElement {
    // Prefer actual card element if nested.
    const card =
      el.closest?.('.bb-card') ||
      el.querySelector?.('.bb-card') ||
      el.closest?.('[data-role="card"]') ||
      el.querySelector?.('[data-role="card"]');
    return (card as HTMLElement) || el;
  }

  function getCenterRect(el: HTMLElement) {
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, rect: r };
  }

  function withTemporaryStyles(el: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    const prev: Partial<CSSStyleDeclaration> = {};
    for (const k of Object.keys(styles) as (keyof CSSStyleDeclaration)[]) {
      // @ts-ignore
      prev[k] = el.style[k];
      // @ts-ignore
      el.style[k] = styles[k] as any;
    }
    return () => {
      for (const k of Object.keys(styles) as (keyof CSSStyleDeclaration)[]) {
        // @ts-ignore
        el.style[k] = (prev[k] as any) ?? '';
      }
    };
  }

  async function playOne(e: AttackFxEvent) {
    const attackerRoot = getElByUnitId(e.attackerId);
    const targetRoot = getElByUnitId(e.targetId);

    if (!attackerRoot || !targetRoot) {
      if (debugEnabled) {
        lastHudRef.current = `attack ${e.id}\nattackerEl: ${!!attackerRoot}\ntargetEl: ${!!targetRoot}\n(attackerId=${e.attackerId}, targetId=${e.targetId})`;
      }
      return;
    }

    const attacker = getCardEl(attackerRoot);
    const target = getCardEl(targetRoot);

    // Temporarily lift attacker above everything and disable clipping in closest slot.
    const attackerSlot = attacker.closest?.('.bb-slot') as HTMLElement | null;
    const undoSlot = attackerSlot
      ? withTemporaryStyles(attackerSlot, { overflow: 'visible' })
      : () => {};

    const undoAttacker = withTemporaryStyles(attacker, {
      willChange: 'transform',
      zIndex: '9999',
      position: attacker.style.position || 'relative',
      pointerEvents: 'none',
    });

    // Also lift parent chain a bit (common clipping cause)
    const parentUndos: Array<() => void> = [];
    let p: HTMLElement | null = attacker.parentElement;
    let hops = 0;
    while (p && hops < 6) {
      const cs = window.getComputedStyle(p);
      if (cs.overflow !== 'visible') {
        parentUndos.push(withTemporaryStyles(p, { overflow: 'visible' }));
      }
      // ensure stacking context
      if (cs.position === 'static') {
        parentUndos.push(withTemporaryStyles(p, { position: 'relative' }));
      }
      hops += 1;
      p = p.parentElement;
    }

    const a = getCenterRect(attacker);
    const t = getCenterRect(target);

    const dx = t.cx - a.cx;
    const dy = t.cy - a.cy;

    if (debugEnabled) {
      lastHudRef.current =
        `attack ${e.id}\n` +
        `attacker: ${e.attackerId}\n` +
        `target: ${e.targetId}\n` +
        `dx=${Math.round(dx)} dy=${Math.round(dy)}\n` +
        `aRect ${Math.round(a.rect.width)}x${Math.round(a.rect.height)} @ ${Math.round(a.rect.left)},${Math.round(a.rect.top)}\n` +
        `tRect ${Math.round(t.rect.width)}x${Math.round(t.rect.height)} @ ${Math.round(t.rect.left)},${Math.round(t.rect.top)}`;
    }

    // Use Web Animations API (fast + doesn't fight React)
    try {
      const anim = attacker.animate(
        [
          { transform: 'translate(0px, 0px)' },
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        { duration: 360, easing: 'cubic-bezier(0.2, 0.9, 0.2, 1)', fill: 'both' }
      );

      // Small "hit" on target
      const targetAnim = target.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }],
        { duration: 220, easing: 'ease-out', delay: 180 }
      );

      await Promise.allSettled([
        anim.finished.catch(() => undefined),
        targetAnim.finished.catch(() => undefined),
      ]);
    } finally {
      undoAttacker();
      undoSlot();
      for (const u of parentUndos.reverse()) u();
    }
  }

  async function drainQueue() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const e = queueRef.current.shift()!;
        await playOne(e);
      }
    } finally {
      runningRef.current = false;
    }
  }

  useEffect(() => {
    if (!mounted) return;
    // enqueue new attack events only
    const pending = mergedEvents.filter((e) => e?.type === 'attack' && !seenIdsRef.current.has(e.id));
    if (pending.length === 0) return;

    for (const e of pending) {
      seenIdsRef.current.add(e.id);
      queueRef.current.push(e);
    }
    void drainQueue();
  }, [mounted, mergedEvents]);

  if (!debugEnabled) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 2147483647,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(0,0,0,0.6)',
        color: 'white',
        fontSize: 12,
        lineHeight: 1.25,
        whiteSpace: 'pre-wrap',
        pointerEvents: 'none',
        maxWidth: 320,
      }}
    >
      {`FX debug\nevents: ${mergedEvents.length}\nseen: ${seenIdsRef.current.size}\n` +
        (lastHudRef.current ? `\n${lastHudRef.current}` : '')}
    </div>
  );
}
