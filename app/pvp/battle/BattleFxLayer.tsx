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

function getElByUnitId(unitId: string) {
  try {
    return document.querySelector<HTMLElement>(`[data-unit-id="${CSS.escape(String(unitId))}"]`);
  } catch {
    return document.querySelector<HTMLElement>(`[data-unit-id="${String(unitId)}"]`);
  }
}

function findBestVisualRoot(unitRoot: HTMLElement): HTMLElement {
  const cardLike =
    unitRoot.querySelector<HTMLElement>('.bb-card, [class*="bb-card"], [class*="Card"], [class*="card"]') || null;
  if (cardLike && cardLike.getBoundingClientRect().width > 0) return cardLike;
  return unitRoot;
}

function makeOverlayFrom(attackerVisual: HTMLElement) {
  const r = attackerVisual.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.className = 'bb-fx-overlay-clone';
  overlay.style.position = 'fixed';
  overlay.style.left = `${r.left}px`;
  overlay.style.top = `${r.top}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  overlay.style.zIndex = '9999';
  overlay.style.pointerEvents = 'none';
  overlay.style.transform = 'translate3d(0px,0px,0)';
  overlay.style.willChange = 'transform';
  overlay.style.contain = 'layout style paint';

  const clone = attackerVisual.cloneNode(true) as HTMLElement;
  clone.style.width = '100%';
  clone.style.height = '100%';
  clone.style.transform = 'none';
  clone.style.pointerEvents = 'none';

  overlay.appendChild(clone);
  return overlay;
}

function animateOverlay(overlay: HTMLElement, dx: number, dy: number) {
  return overlay.animate(
    [
      { transform: 'translate3d(0px, 0px, 0) scale(1)' },
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(1.03)`, offset: 0.55 },
      { transform: `translate3d(${dx * 0.92}px, ${dy * 0.92}px, 0) scale(1.00)`, offset: 0.7 },
      { transform: 'translate3d(0px, 0px, 0) scale(1)' },
    ],
    {
      duration: ATTACK_DURATION,
      easing: 'cubic-bezier(.18,.9,.22,1)',
      fill: 'both',
    }
  );
}

export default function BattleFxLayer({ events }: { events: FxEvent[] }) {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const [debugMsg, setDebugMsg] = useState('');
  const [debugCount, setDebugCount] = useState(0);

  const debugEnabled = useMemo(() => {
    try {
      return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('fxdebug') === '1';
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    setMounted(true);
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
        max-width: 60vw;
        white-space: pre-wrap;
      }
    `,
    []
  );

  useEffect(() => {
    if (!mounted) return;

    const timers: any[] = [];
    const rafs: number[] = [];

    if (debugEnabled) setDebugCount((events || []).length);

    const tryOnce = (attackerId: string, targetId: string) => {
      const attackerRoot = getElByUnitId(attackerId);
      const targetRoot = getElByUnitId(targetId);
      if (!attackerRoot || !targetRoot) return false;

      const attackerVisual = findBestVisualRoot(attackerRoot);
      const targetVisual = findBestVisualRoot(targetRoot);

      const ar = attackerVisual.getBoundingClientRect();
      const tr = targetVisual.getBoundingClientRect();
      if (!ar.width || !ar.height || !tr.width || !tr.height) return false;

      const { dx, dy } = computeTouchDelta(ar, tr);

      if (debugEnabled) {
        attackerVisual.classList.add('bb-fx-debug-outline-attacker');
        targetVisual.classList.add('bb-fx-debug-outline-target');
        timers.push(
          window.setTimeout(() => {
            attackerVisual.classList.remove('bb-fx-debug-outline-attacker');
            targetVisual.classList.remove('bb-fx-debug-outline-target');
          }, 500)
        );
      }

      const overlay = makeOverlayFrom(attackerVisual);
      document.body.appendChild(overlay);

      const anim = animateOverlay(overlay, dx, dy);
      anim.onfinish = () => overlay.remove();

      timers.push(
        window.setTimeout(() => {
          try {
            overlay.remove();
          } catch {}
        }, ATTACK_DURATION + 140)
      );

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
          setDebugMsg(
            `FX: DOM not found for\nattackerId=${attackerId}\ntargetId=${targetId}\n(data-unit-id mismatch?)`
          );
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
      <style>{css}</style>
      {debugEnabled ? <div className="bb-fx-debug-hud">{`FX events: ${debugCount}\n${debugMsg}`}</div> : null}
    </>,
    document.body
  );
}
