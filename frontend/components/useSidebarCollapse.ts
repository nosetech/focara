"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SIDEBAR_STORAGE_KEY,
  parseSidebarCollapsed,
  serializeSidebar,
} from "@/lib/panelSize";

/** マウスオーバーで一時展開(peek)するまで / 閉じるまでの遅延(ms) */
const PEEK_OPEN_MS = 140;
const PEEK_CLOSE_MS = 220;

/**
 * メニューの折りたたみ状態(PC幅のみ意味を持つ)。
 * SSRとの不一致を避けるため、保存値はマウント後に復元する。
 */
export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false);
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSRとの不一致を避けるためマウント後に復元する
      setCollapsed(
        parseSidebarCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)),
      );
    } catch {
      // localStorage が使えない環境では既定(展開)のまま
    }
    return () => clearTimeout(timer.current);
  }, []);

  const toggle = useCallback(() => {
    clearTimeout(timer.current);
    setPeek(false);
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          SIDEBAR_STORAGE_KEY,
          serializeSidebar(next),
        );
      } catch {
        // 保存できなくても操作は続ける
      }
      return next;
    });
  }, []);

  const schedule = useCallback((next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(next), ms);
  }, []);

  const onEnter = useCallback(() => schedule(true, PEEK_OPEN_MS), [schedule]);
  const onLeave = useCallback(() => schedule(false, PEEK_CLOSE_MS), [schedule]);

  return {
    collapsed,
    /** 折りたたみ中で、マウスオーバーで一時展開していない(アイコンのみ表示) */
    iconOnly: collapsed && !peek,
    peek: collapsed && peek,
    toggle,
    onEnter,
    onLeave,
  };
}
