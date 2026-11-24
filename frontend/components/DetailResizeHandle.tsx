"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  DETAIL_KEY_STEP,
  DETAIL_MIN_WIDTH,
  clampDetailWidth,
  detailMaxWidth,
  widthFromDrag,
} from "@/lib/panelSize";
import styles from "./DetailResizeHandle.module.css";

/** タスク詳細の左端に置く、幅を変える縦のハンドル(PC幅のみ表示)。 */
export function DetailResizeHandle({
  width,
  onChange,
  onCommit,
  onReset,
  edge = "outside",
}: {
  width: number;
  onChange: (w: number) => void;
  onCommit: (w: number) => void;
  onReset: () => void;
  /** outside: 詳細の外側に半分はみ出す / inside: 詳細の内側に収める(overflow:hidden の中) */
  edge?: "outside" | "inside";
}) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);
  const latest = useRef(width);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    latest.current = width;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = widthFromDrag(
      start.current.w,
      e.clientX - start.current.x,
      window.innerWidth,
    );
    latest.current = next;
    onChange(next);
  };

  const end = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onCommit(latest.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // 左へ動かすと広がる(ハンドルは詳細の左端にある)
    const delta =
      e.key === "ArrowLeft"
        ? DETAIL_KEY_STEP
        : e.key === "ArrowRight"
          ? -DETAIL_KEY_STEP
          : 0;
    if (delta === 0) return;
    e.preventDefault();
    const next = clampDetailWidth(width + delta, window.innerWidth);
    onChange(next);
    onCommit(next);
  };

  return (
    <div
      className={styles.handle}
      data-edge={edge}
      data-dragging={dragging ? "" : undefined}
      role="separator"
      aria-orientation="vertical"
      aria-label="詳細パネルの幅を変更"
      aria-valuenow={width}
      aria-valuemin={DETAIL_MIN_WIDTH}
      aria-valuemax={detailMaxWidth(
        typeof window === "undefined" ? 1500 : window.innerWidth,
      )}
      tabIndex={0}
      suppressHydrationWarning
      title="ドラッグで幅を変更(ダブルクリックで既定幅)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
