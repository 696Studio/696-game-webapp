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

  // чтобы не улетало слишком далеко
  const k = 0.9;
  const maxMove = Math.max(a.width, a.height) * 1.15;
  const len = Math.hypot(dx, dy) || 1;
  const safeK = clamp((maxMove / len) * k, 0.55, 0.92);

  return { dx: dx * safeK, dy: dy * safeK };
}

function safeEscape(v: string) {
  // CSS.escape может отсутствовать в старых вебвью
  try {
    const cssAny = CSS as unknown as { escape?: (s: string) => string };
    return typeof cssAny !== 'undefined' && typeof cssAny.escape === 'function' ? cssAny.escape(v) : v.replace(/"/g, '\\"');
  } catch {
    return v.replace(/"/g, '\\"');
  }
}

function getUnitRootById(unitId: string) {
  return document.querySelector<HTMLElement>(`[data-unit-id="${safeEscape(String(unitId))}"]`);
}

/**
 * КЛЮЧЕВАЯ ИДЕЯ (чтобы не конфликтовать с вашей версткой/transform'ами):
 * У вас УЖЕ есть рабочая CSS-анимация в battle.animations.css:
 *   .bb-card.is-attacking { animation: bb_card_lunge_to_target ... }
 * которая использует CSS vars:
 *   --atk-dx / --atk-dy
 *
 * Значит самый надёжный путь — не изобретать новые transform-ы, а ТРИГГЕРИТЬ
 * существующую систему: выставить --atk-dx/--atk-dy на .bb-card и добавить классы
 * is-attacking / is-attack-target.
 *
 * Это двигает ОРИГИНАЛ (не клон) и не требует переносов DOM (без removeChild крашей).
 */
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

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) setDebugCount((events || []).length);

    const cleanupAttack = (attackerCard: HTMLElement, targetCard: HTMLElement) => {
      try {
        attackerCard.classList.remove('is-attacking');
        attackerCard.style.removeProperty('--atk-dx');
        attackerCard.style.removeProperty('--atk-dy');
      } catch {}
      try {
        targetCard.classList.remove('is-attack-target');
      } catch {}
    };

    const findCardEl = (root: HTMLElement) => {
      // В page.tsx data-unit-id стоит и на .bb-card, и на .bb-slot.
      // Нам нужна именно визуальная карта, на которую повешен CSS из battle.animations.css.
      if (root.classList.contains('bb-card')) return root;
      const inner = root.querySelector<HTMLElement>('.bb-card');
      return inner || root;
    };

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getUnitRootById(attackerId);
      const targetRoot = getUnitRootById(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const attackerCard = findCardEl(attackerRoot);
      const targetCard = findCardEl(targetRoot);

      const ar = attackerCard.getBoundingClientRect();
      const tr = targetCard.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerCard.classList.add('bb-fx-debug-outline-attacker');
        targetCard.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerCard.classList.remove('bb-fx-debug-outline-attacker');
            targetCard.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      // Триггерим вашу CSS-анимацию:
      attackerCard.style.setProperty('--atk-dx', `${dx}px`);
      attackerCard.style.setProperty('--atk-dy', `${dy}px`);

      // restart animation reliably
      attackerCard.classList.remove('is-attacking');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      attackerCard.offsetHeight;
      attackerCard.classList.add('is-attacking');

      targetCard.classList.remove('is-attack-target');
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      targetCard.offsetHeight;
      targetCard.classList.add('is-attack-target');

      timers.push(window.setTimeout(() => cleanupAttack(attackerCard, targetCard), ATTACK_DURATION + 80));
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
          setDebugMsg(`FX: DOM not found / card not ready\nattackerId=${attackerId}\ntargetId=${targetId}`);
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

  const css = debugEnabled
    ? `
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
    `
    : '';

  return createPortal(
    <>
      {debugEnabled ? <style>{css}</style> : null}
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
