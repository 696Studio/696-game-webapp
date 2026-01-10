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

const LUNGE_DURATION = 420;
const TARGET_HIT_DURATION = 240;
const RETRY_FRAMES = 18;

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

  // чтобы не улетало слишком далеко
  const k = 0.92;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 1.0);

  return { dx: dx * safeK, dy: dy * safeK };
}

function safeEscape(v: string) {
  // CSS.escape может отсутствовать в старых вебвью
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function'
      ? cssAny.escape(v)
      : v.replace(/"/g, '\"');
  } catch {
    return v.replace(/"/g, '\"');
  }
}

function qUnit(unitId: string) {
  const id = safeEscape(String(unitId));
  // Prefer the dedicated motion layer (no transform conflicts)
  const motion = document.querySelector<HTMLElement>(`.bb-motion-layer[data-unit-id="${id}"]`);
  if (motion) return motion;

  // Fallbacks (older markup)
  const slot = document.querySelector<HTMLElement>(`.bb-slot[data-unit-id="${id}"]`);
  if (slot) return slot;

  return document.querySelector<HTMLElement>(`[data-unit-id="${id}"]`);
}

function qTargetCard(unitId: string) {
  const root = qUnit(unitId);
  if (!root) return null;

  // If root is the motion layer, find the card inside
  const card = root.querySelector<HTMLElement>('.bb-card');
  if (card) return card;

  // If root itself is card
  if ((root.className || '').toString().includes('bb-card')) return root;

  return null;
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const timersByElRef = useRef<WeakMap<HTMLElement, number[]>>(new WeakMap());

  const [mounted, setMounted] = useState(false);
  const [debugMsg, setDebugMsg] = useState<string>('');
  const [debugCount, setDebugCount] = useState<number>(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  const css = useMemo(
    () => `
      /* Debug helpers */
      .bb-fx-debug-outline-attacker { outline: 2px solid rgba(0,255,255,.85) !important; }
      .bb-fx-debug-outline-target   { outline: 2px solid rgba(255,0,255,.85) !important; }

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
        max-width: 60vw;
        white-space: pre-wrap;
      }
    `,
    []
  );

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) setDebugCount((events || []).length);

    const clearTimersForEl = (el: HTMLElement) => {
      const list = timersByElRef.current.get(el);
      if (!list) return;
      for (const t of list) clearTimeout(t);
      timersByElRef.current.delete(el);
    };

    const addTimerForEl = (el: HTMLElement, t: number) => {
      const list = timersByElRef.current.get(el) || [];
      list.push(t);
      timersByElRef.current.set(el, list);
      timers.push(t);
    };

    const startLunge = (attackerEl: HTMLElement, targetId: string, dx: number, dy: number) => {
      clearTimersForEl(attackerEl);

      attackerEl.style.setProperty('--atk-dx', `${dx}px`);
      attackerEl.style.setProperty('--atk-dy', `${dy}px`);

      attackerEl.classList.remove('is-attacking'); // reset if stuck
      // reflow to restart animation reliably
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      attackerEl.offsetWidth;
      attackerEl.classList.add('is-attacking');

      const t1 = window.setTimeout(() => {
        attackerEl.classList.remove('is-attacking');
        attackerEl.style.removeProperty('--atk-dx');
        attackerEl.style.removeProperty('--atk-dy');
      }, LUNGE_DURATION + 40);
      addTimerForEl(attackerEl, t1);

      // impact on target card (optional)
      const targetCard = qTargetCard(targetId);
      if (targetCard) {
        clearTimersForEl(targetCard);
        targetCard.classList.remove('is-attack-target');
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        targetCard.offsetWidth;
        targetCard.classList.add('is-attack-target');

        const t2 = window.setTimeout(() => targetCard.classList.remove('is-attack-target'), TARGET_HIT_DURATION + 40);
        addTimerForEl(targetCard, t2);
      }
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerEl = qUnit(attackerId);
      const targetEl = qUnit(targetId);

      if (!attackerEl || !targetEl) return false;

      const ar = attackerEl.getBoundingClientRect();
      const tr = targetEl.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerEl.classList.add('bb-fx-debug-outline-attacker');
        targetEl.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerEl.classList.remove('bb-fx-debug-outline-attacker');
            targetEl.classList.remove('bb-fx-debug-outline-target');
          }, 520)
        );
      }

      startLunge(attackerEl, targetId, dx, dy);
      return true;
    };

    const runWithRetry = (attackerId: string, targetId: string) => {
      let frame = 0;
      const tick = () => {
        frame += 1;
        const ok = tryOnce(attackerId, targetId);
        if (ok) return;

        if (frame < RETRY_FRAMES) {
          rafs.push(requestAnimationFrame(tick));
        } else if (debugEnabled) {
          setDebugMsg(`FX: DOM not found for\nattackerId=${attackerId}\ntargetId=${targetId}\n(data-unit-id mismatch?)`);
          timers.push(window.setTimeout(() => setDebugMsg(''), 1200));
        }
      };
      rafs.push(requestAnimationFrame(tick));
    };

    for (const e of events || []) {
      if (e.type !== 'attack') continue;
      if (!e.id || !e.attackerId || !e.targetId) continue;
      if (seenIdsRef.current.has(e.id)) continue;

      seenIdsRef.current.add(e.id);
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), LUNGE_DURATION + 800));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
      timersByElRef.current = new WeakMap();
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      <style>{css}</style>
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
