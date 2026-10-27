"use client";

import { createContext, useContext } from "react";
import type { OrganizeFilters } from "@/lib/inbox";
import type { ToastMessage } from "./Toast";

export interface OrganizeProject {
  id: number;
  name: string;
}

/** 整理画面の共通シェルが持つ状態(絞り込み・プロジェクト・詳細パネル・トースト)を各画面へ渡す。 */
export interface OrganizeContextValue {
  filters: OrganizeFilters;
  clearFilters: () => void;
  projects: OrganizeProject[];
  /** 詳細パネルの描画先。デスクトップのみ存在する */
  panelEl: HTMLElement | null;
  /** 日付ナビで選んでいる日 */
  date: Date;
  setDate: (date: Date) => void;
  refreshCounts: () => void;
  showToast: (toast: ToastMessage) => void;
  openQuickAdd: () => void;
}

export const OrganizeContext = createContext<OrganizeContextValue | null>(null);

export function useOrganize(): OrganizeContextValue {
  const ctx = useContext(OrganizeContext);
  if (!ctx) throw new Error("OrganizeShell の外では使えません");
  return ctx;
}
