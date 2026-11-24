"use client";

import { createContext, useContext } from "react";

interface Shell {
  openQuickAdd: () => void;
}

export const ShellContext = createContext<Shell>({ openQuickAdd: () => {} });

export const useShell = () => useContext(ShellContext);
