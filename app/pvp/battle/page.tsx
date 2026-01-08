'use client';

/**
 * page.battleLogic.tsx
 *
 * STEP 1 — CLEAN BATTLE LOGIC CORE
 * --------------------------------
 * PURPOSE:
 * - Rebuild battle logic from old page.tsx
 * - ZERO FX
 * - ZERO animations
 * - ZERO DOM access
 * - ZERO portals
 *
 * This file is intentionally SIMPLE and STABLE.
 * It is the foundation we will extend step-by-step.
 */

import { useEffect, useMemo, useState } from 'react';

// --------------------
// Types (minimal set)
// --------------------

type Unit = {
  id: string;
  title: string;
  hp: number;
  atk: number;
  alive: boolean;
};

type BattleState = {
  units: Unit[];
  turn: number;
};

// --------------------
// Mock / initial data
// (replace later with real data source)
// --------------------

const INITIAL_UNITS: Unit[] = [
  { id: 'a1', title: 'Unit A', hp: 10, atk: 3, alive: true },
  { id: 'b1', title: 'Unit B', hp: 10, atk: 2, alive: true },
];

// --------------------
// Page
// --------------------

export default function PvpBattleLogicPage() {
  const [battle, setBattle] = useState<BattleState>({
    units: INITIAL_UNITS,
    turn: 0,
  });

  // --------------------
  // Derived state
  // --------------------

  const attacker = useMemo(() => battle.units[0], [battle.units]);
  const defender = useMemo(() => battle.units[1], [battle.units]);

  // --------------------
  // Core battle action
  // --------------------

  function nextTurn() {
    setBattle((prev) => {
      if (!prev.units[0].alive || !prev.units[1].alive) return prev;

      const dmg = prev.units[0].atk;

      const newUnits = prev.units.map((u) => {
        if (u.id === prev.units[1].id) {
          const newHp = u.hp - dmg;
          return {
            ...u,
            hp: newHp,
            alive: newHp > 0,
          };
        }
        return u;
      });

      return {
        units: newUnits,
        turn: prev.turn + 1,
      };
    });
  }

  // --------------------
  // Auto battle loop (for testing)
  // --------------------

  useEffect(() => {
    if (!defender.alive) return;
    const t = setTimeout(nextTurn, 800);
    return () => clearTimeout(t);
  }, [battle.turn, defender.alive]);

  // --------------------
  // Render (NO FX)
  // --------------------

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0b0b0f',
        color: '#fff',
        padding: 24,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h2>PVP Battle — Logic Core</h2>

      <div style={{ display: 'flex', gap: 24, marginTop: 24 }}>
        {battle.units.map((u) => (
          <div
            key={u.id}
            style={{
              width: 160,
              padding: 12,
              borderRadius: 8,
              background: '#15151c',
              opacity: u.alive ? 1 : 0.4,
            }}
          >
            <div style={{ fontWeight: 600 }}>{u.title}</div>
            <div>HP: {u.hp}</div>
            <div>ATK: {u.atk}</div>
            {!u.alive && <div style={{ color: '#f55' }}>DEAD</div>}
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, opacity: 0.7 }}>
        Turn: {battle.turn}
      </div>
    </div>
  );
}
