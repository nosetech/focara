"use client";

import { useCallback, useEffect, useRef } from "react";
import { createCoalescer } from "@/lib/detailSync";

const SAVED_DEBOUNCE_MS = 300;

/**
 * 一覧画面が詳細(TaskDetail)の保存を一覧へ反映するための共通フック。
 * - `onSaved`: 詳細の保存完了時に渡す。連続した保存は1回の取り直しにまとめる。
 * - `refreshNow`: 詳細を閉じたときなど、待たずに取り直す。
 * `refetch` は一覧の再取得と件数の更新をまとめた関数。
 */
export function useTaskDetailSync(refetch: () => void) {
  const refetchRef = useRef(refetch);
  const coalescer = useRef<ReturnType<typeof createCoalescer>>(undefined);
  useEffect(() => {
    refetchRef.current = refetch;
  });
  useEffect(() => {
    const c = createCoalescer(() => refetchRef.current(), SAVED_DEBOUNCE_MS);
    coalescer.current = c;
    return () => {
      c.cancel();
      coalescer.current = undefined;
    };
  }, []);
  const onSaved = useCallback(() => coalescer.current?.notify(), []);
  const refreshNow = useCallback(() => coalescer.current?.flushNow(), []);
  return { onSaved, refreshNow };
}
