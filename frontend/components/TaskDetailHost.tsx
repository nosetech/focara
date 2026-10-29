"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useOrganize } from "./OrganizeContext";
import { TaskDetail } from "./TaskDetail";
import styles from "./OrganizeShell.module.css";

const DESKTOP_QUERY = "(min-width: 900px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DESKTOP_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** 整理画面シェルのブレークポイント(900px)でデスクトップ幅かを返す。 */
function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

/**
 * 選択中のタスクの詳細を出す。デスクトップは右ペイン(panel)、モバイルは画面下のシート。
 * `showEmpty` のときは未選択でも右ペインに案内を出す(一覧画面)。
 */
export function TaskDetailHost({
  taskId,
  onClose,
  showEmpty = false,
  sheetOpen = true,
}: {
  taskId: number | null;
  onClose: () => void;
  showEmpty?: boolean;
  /** モバイルのシートを開くか。キーボード操作で常に選択中になる画面は、タップするまで閉じておく */
  sheetOpen?: boolean;
}) {
  const { panelEl } = useOrganize();
  const desktop = useIsDesktop();

  const detail =
    taskId != null ? (
      <TaskDetail
        key={taskId}
        variant={desktop ? "panel" : "sheet"}
        taskId={taskId}
        onClose={onClose}
      />
    ) : null;

  if (!desktop) return sheetOpen ? detail : null;
  if (!panelEl) return null;
  const content =
    detail ??
    (showEmpty ? (
      <div className={styles.panelEmpty}>
        行を選択すると
        <br />
        ここに詳細が表示されます
      </div>
    ) : null);
  return content && createPortal(content, panelEl);
}
