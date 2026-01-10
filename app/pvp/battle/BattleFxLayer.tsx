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

const ATTACK_DURATION = 520;
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

  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

function safeEscape(v: string) {
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function'
      ? cssAny.escape(v)
      : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

/**
 * У вас в DOM ДВА элемента с одинаковым data-unit-id:
 *  - .bb-slot (внешний контейнер)
 *  - .bb-card (внутренний)
 *
 * document.querySelector вернет ПЕРВЫЙ попавшийся, что иногда оказывается .bb-card,
 * а внутри .bb-card НЕТ .bb-motion-layer (она sibling/родитель).
 *
 * Поэтому:
 * 1) берём ВСЕ совпадения querySelectorAll
 * 2) приоритет: .bb-slot, потом любой элемент, который содержит .bb-motion-layer
 * 3) fallback: первый элемент
 */
function getBestUnitRootById(unitId: string) {
  const list = Array.from(document.querySelectorAll<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`));
  if (!list.length) return null;

  const slot = list.find((el) => el.classList.contains('bb-slot'));
  if (slot) return slot;

  const hasMotion = list.find((el) => !!el.querySelector('.bb-motion-layer'));
  if (hasMotion) return hasMotion;

  // maybe data-unit-id is on inner bb-card; go up to nearest slot
  for (const el of list) {
    const up = el.closest('.bb-slot') as HTMLElement | null;
    if (up) return up;
  }

  return list[0];
}

function findVisualCardEl(unitRoot: HTMLElement): HTMLElement {
  if (unitRoot.classList.contains('bb-card')) return unitRoot;
  return unitRoot.querySelector<HTMLElement>('.bb-card') || unitRoot;
}

function findMotionLayerFromAny(unitRoot: HTMLElement): HTMLElement | null {
  // preferred: inside slot
  const slot = unitRoot.classList.contains('bb-slot') ? unitRoot : (unitRoot.closest('.bb-slot') as HTMLElement | null);
  if (slot) {
    const ml = slot.querySelector<HTMLElement>('.bb-motion-layer');
    if (ml) return ml;
  }

  // fallback: inside provided root
  const inside = unitRoot.querySelector<HTMLElement>('.bb-motion-layer');
  if (inside) return inside;

  // fallback: if root is bb-card, motion-layer is likely a parent sibling in slot
  const up2 = unitRoot.closest('.bb-slot') as HTMLElement | null;
  return up2 ? up2.querySelector<HTMLElement>('.bb-motion-layer') : null;
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
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
        max-width: 70vw;
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

    const cleanup = (motionEl: HTMLElement | null, targetCard: HTMLElement | null) => {
      try {
        if (motionEl) {
          motionEl.removeAttribute('data-fx-attacking');
          motionEl.style.removeProperty('--atk-dx');
          motionEl.style.removeProperty('--atk-dy');
        }
      } catch {}
      try {
        if (targetCard) targetCard.removeAttribute('data-fx-attack-target');
      } catch {}
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getBestUnitRootById(attackerId);
      const targetRoot = getBestUnitRootById(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const motionEl = findMotionLayerFromAny(attackerRoot);
      const attackerForRect = motionEl || findVisualCardEl(attackerRoot);

      const targetCard = findVisualCardEl(targetRoot);

      const ar = attackerForRect.getBoundingClientRect();
      const tr = targetCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerForRect.classList.add('bb-fx-debug-outline-attacker');
        targetCard.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerForRect.classList.remove('bb-fx-debug-outline-attacker');
            targetCard.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      if (!motionEl) {
        if (debugEnabled) {
          const hint = attackerRoot.classList.contains('bb-card')
            ? 'root=bb-card (likely wrong pick)'
            : attackerRoot.classList.contains('bb-slot')
            ? 'root=bb-slot (ok)'
            : `root=${attackerRoot.className}`;
          setDebugMsg(`FX: .bb-motion-layer NOT FOUND\n${hint}\nattackerId=${attackerId}`);
          timers.push(window.setTimeout(() => setDebugMsg(''), 1200));
        }
        return false;
      }

      // Trigger animation via DATA ATTRIBUTES (React won't wipe them)
      motionEl.style.setProperty('--atk-dx', `${dx}px`);
      motionEl.style.setProperty('--atk-dy', `${dy}px`);

      // restart: flip attribute off->on
      motionEl.removeAttribute('data-fx-attacking');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      motionEl.offsetHeight;
      motionEl.setAttribute('data-fx-attacking', '1');

      targetCard.removeAttribute('data-fx-attack-target');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      targetCard.offsetHeight;
      targetCard.setAttribute('data-fx-attack-target', '1');

      timers.push(window.setTimeout(() => cleanup(motionEl, targetCard), ATTACK_DURATION + 120));

      if (debugEnabled) {
        setDebugMsg(`FX: OK\nmotion-layer=yes\ndx=${Math.round(dx)} dy=${Math.round(dy)}\nattacker=${attackerId}\ntarget=${targetId}`);
        timers.push(window.setTimeout(() => setDebugMsg(''), 900));
      }

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
          setDebugMsg(`FX: failed after retries\nattackerId=${attackerId}\ntargetId=${targetId}`);
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
      timers.push(window.setTimeout(() => seenIdsRef.current.delete(e.id), ATTACK_DURATION + 800));

      runWithRetry(String(e.attackerId), String(e.targetId));
    }

    return () => {
      for (const t of timers) clearTimeout(t);
      for (const r of rafs) cancelAnimationFrame(r);
    };
  }, [events, debugEnabled, mounted]);

  if (!mounted) return null;

  return createPortal(
    <>
      {debugEnabled ? <style>{css}</style> : null}
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
