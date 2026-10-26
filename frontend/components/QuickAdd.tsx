"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import styles from "./QuickAdd.module.css";

const TOAST_MS = 1800;

type Status = "typing" | "saving" | "error";

/** inboxにタスクを追加したことを整理画面などへ知らせるイベント */
export const TASK_ADDED_EVENT = "focara:task-added";

export function QuickAdd({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<Status>("typing");
  const [added, setAdded] = useState(0);
  const [toast, setToast] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(toastTimer.current);
  }, []);

  const submit = useCallback(async () => {
    const title = value.trim();
    if (!title || status === "saving") return;
    setStatus("saving");
    setToast(false);
    try {
      await apiFetch("/tasks", { method: "POST", body: { title } });
      window.dispatchEvent(new Event(TASK_ADDED_EVENT));
    } catch {
      setStatus("error");
      return;
    }
    setValue("");
    setStatus("typing");
    setAdded((n) => n + 1);
    setToast(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(false), TOAST_MS);
    inputRef.current?.focus();
  }, [value, status]);

  const saving = status === "saving";

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="inboxに追加"
      >
        <div className={styles.toast} data-show={toast ? "" : undefined}>
          <div role="status" className={styles.toastBody}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {toast ? "inboxに追加しました" : ""}
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.grabber} />
          <div className={styles.head}>
            <span className={styles.label}>inboxに追加</span>
            <span className={styles.esc}>Esc で閉じる</span>
          </div>
          <div className={styles.row}>
            <input
              ref={inputRef}
              className={styles.input}
              data-error={status === "error" ? "" : undefined}
              value={value}
              readOnly={saving}
              placeholder="思いついたことを1行で"
              enterKeyHint="send"
              onChange={(e) => {
                setValue(e.target.value);
                if (status === "error") setStatus("typing");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Escape") {
                  onClose();
                }
              }}
            />
            <button
              className={styles.send}
              aria-label="保存"
              onClick={() => void submit()}
              style={{ opacity: value.trim() || saving ? 1 : 0.35 }}
            >
              {saving ? (
                <span>保存中</span>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              )}
            </button>
          </div>
          <div className={styles.foot}>
            {status === "error" && (
              <>
                <span role="alert" className={styles.error}>
                  保存できませんでした。入力内容は残っています。
                </span>
                <button className={styles.retry} onClick={() => void submit()}>
                  再試行
                </button>
              </>
            )}
            {saving && <span className={styles.sub}>保存しています…</span>}
            {status === "typing" && (
              <>
                <span className={styles.hint}>
                  Enter で保存 · 保存後もそのまま続けて入力できます
                </span>
                {added > 0 && (
                  <span className={styles.count}>
                    <span className={styles.mono}>{added}</span>件追加
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
