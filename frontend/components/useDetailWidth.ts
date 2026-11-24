"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DETAIL_STORAGE_KEY,
  clampDetailWidth,
  parseDetailWidth,
} from "@/lib/panelSize";

/**
 * タスク詳細(PC幅)の幅。保存値はマウント後に復元し、ウィンドウが縮んだら範囲に収める。
 * `commit` で保存する(ドラッグ中は `setWidth` だけで保存しない)。
 */
export function useDetailWidth(defaultWidth: number) {
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    try {
      const saved = parseDetailWidth(
        window.localStorage.getItem(DETAIL_STORAGE_KEY),
        window.innerWidth,
      );
      // eslint-disable-next-line react-hooks/set-state-in-effect -- SSRとの不一致を避けるためマウント後に復元する
      if (saved != null) setWidth(saved);
    } catch {
      // localStorage が使えない環境では既定幅のまま
    }
    const onResize = () =>
      setWidth((w) => clampDetailWidth(w, window.innerWidth));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const commit = useCallback((w: number) => {
    try {
      window.localStorage.setItem(DETAIL_STORAGE_KEY, JSON.stringify(w));
    } catch {
      // 保存できなくても操作は続ける
    }
  }, []);

  const reset = useCallback(() => {
    setWidth(defaultWidth);
    try {
      window.localStorage.removeItem(DETAIL_STORAGE_KEY);
    } catch {
      // 保存できなくても操作は続ける
    }
  }, [defaultWidth]);

  return { width, setWidth, commit, reset };
}
