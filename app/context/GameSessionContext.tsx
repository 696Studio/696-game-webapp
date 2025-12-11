"use client";

import React, {
  createContext,
  useContext,
  ReactNode,
} from "react";
import { useGameSession } from "../hooks/useGameSession";

type GameSessionContextValue = ReturnType<typeof useGameSession>;

const GameSessionContext = createContext<GameSessionContextValue | null>(null);

export function GameSessionProvider({ children }: { children: ReactNode }) {
  const session = useGameSession();

  return (
    <GameSessionContext.Provider value={session}>
      {children}
    </GameSessionContext.Provider>
  );
}

export function useGameSessionContext(): GameSessionContextValue {
  const ctx = useContext(GameSessionContext);
  if (!ctx) {
    throw new Error(
      "useGameSessionContext must be used within <GameSessionProvider>"
    );
  }
  return ctx;
}
