"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  STATUS_LABEL,
  blocksCompletion,
  needsSave,
  normalizeValue,
  overallStatus,
  toRows,
  validateValue,
  type RunPropertyRow,
} from "@/lib/runProperties";
import { propertyBody, type TaskProperty } from "@/lib/taskDetail";
import styles from "./RunProperties.module.css";

/** 親(RunScreen)が完了前に呼ぶ。未保存の入力を保存し、完了してよいかを返す。 */
export interface RunPropertiesHandle {
  flush: () => Promise<boolean>;
}

type Load = "loading" | "error" | "ready";

export function RunProperties({
  taskId,
  handleRef,
  onBlockedChange,
}: {
  taskId: number;
  handleRef: Ref<RunPropertiesHandle>;
  onBlockedChange: (blocked: boolean) => void;
}) {
  const [load, setLoad] = useState<Load>("loading");
  const [rows, setRowsState] = useState<RunPropertyRow[]>([]);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const rowsRef = useRef<RunPropertyRow[]>([]);
  const inflight = useRef(new Map<number, Promise<boolean>>());
  const alive = useRef(true);

  const setRows = useCallback(
    (fn: (rs: RunPropertyRow[]) => RunPropertyRow[]) => {
      rowsRef.current = fn(rowsRef.current);
      if (alive.current) setRowsState(rowsRef.current);
    },
    [],
  );
  const patchRow = useCallback(
    (id: number, patch: Partial<RunPropertyRow>) =>
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r))),
    [setRows],
  );

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    alive.current = true;
    const pending = inflight.current;
    apiFetch<TaskProperty[]>(`/tasks/${taskId}/properties`)
      .then((props) => {
        if (!alive.current) return;
        setRows(() => toRows(props));
        setLoad("ready");
      })
      .catch(() => {
        if (alive.current) setLoad("error");
      });
    return () => {
      alive.current = false;
      pending.clear();
    };
  }, [taskId, attempt, setRows]);

  const blocked = load === "ready" && blocksCompletion(rows);
  useEffect(() => {
    onBlockedChange(blocked);
  }, [blocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange(false), [onBlockedChange]);

  /** 1行を保存する。戻り値は「この行が完了を止めない状態か」。 */
  const saveRow = useCallback(
    (id: number): Promise<boolean> => {
      const run = async (): Promise<boolean> => {
        const r = rowsRef.current.find((x) => x.id === id);
        if (!r) return true;
        const value = normalizeValue(r.value_type, r.value);
        const err = validateValue(r.value_type, r.key, r.value);
        if (err) {
          patchRow(id, { error: err, justSaved: false });
          return false;
        }
        if (!needsSave(r)) {
          patchRow(id, { error: null, saveError: null });
          return true;
        }
        const body = propertyBody({
          localId: "",
          id,
          key: r.key,
          value,
          value_type: r.value_type,
          unit: r.unit,
        });
        if (!body || "error" in body) return false;
        patchRow(id, { saving: true, error: null, saveError: null });
        try {
          await apiFetch<TaskProperty>(`/tasks/${taskId}/properties/${id}`, {
            method: "PATCH",
            body,
          });
          patchRow(id, {
            saving: false,
            justSaved: true,
            error: null,
            saveError: null,
            saved: r.value,
          });
          return true;
        } catch {
          patchRow(id, {
            saving: false,
            justSaved: false,
            saveError: "保存できませんでした。完了を押すと再試行します",
          });
          return false;
        }
      };
      // 同じ行の保存は直列にする(後の保存が先の保存より先に終わらないように)
      const prev = inflight.current.get(id) ?? Promise.resolve(true);
      const next = prev.then(run, run);
      inflight.current.set(id, next);
      return next;
    },
    [taskId, patchRow],
  );

  useImperativeHandle(
    handleRef,
    () => ({
      flush: async () => {
        if (load !== "ready") return true;
        const results = await Promise.all(
          rowsRef.current.map((r) => saveRow(r.id)),
        );
        return results.every(Boolean);
      },
    }),
    [load, saveRow],
  );

  if (load === "ready" && rows.length === 0) return null;

  const status = overallStatus(rows, focusedId);

  return (
    <section className={styles.props} aria-label="プロパティ">
      <div className={styles.head}>
        <span className={styles.headLabel}>プロパティ</span>
        {load === "ready" && (
          <span
            className={styles.status}
            data-status={status}
            role="status"
            aria-live="polite"
          >
            {status === "saved" && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {STATUS_LABEL[status]}
          </span>
        )}
      </div>

      {load === "loading" && <div className={styles.note}>読み込み中…</div>}
      {load === "error" && (
        <div className={styles.fail}>
          <span>
            プロパティを読み込めませんでした。通信状態を確認して、もう一度お試しください。
          </span>
          <button
            type="button"
            onClick={() => {
              setLoad("loading");
              setAttempt((n) => n + 1);
            }}
          >
            再試行
          </button>
        </div>
      )}
      {load === "ready" &&
        rows.map((r) => {
          const inputId = `run-prop-${r.id}`;
          const mono = r.value_type === "number" || r.value_type === "date";
          return (
            <div key={r.id} className={styles.row}>
              <label htmlFor={inputId} className={styles.label}>
                {r.key}
              </label>
              <div className={styles.field}>
                <input
                  id={inputId}
                  className={styles.input}
                  data-mono={mono ? "" : undefined}
                  data-error={r.error || r.saveError ? "" : undefined}
                  type={r.value_type === "date" ? "date" : "text"}
                  inputMode={r.value_type === "number" ? "decimal" : undefined}
                  placeholder={
                    r.value_type === "number"
                      ? "0.0"
                      : r.value_type === "string"
                        ? "入力"
                        : undefined
                  }
                  value={r.value}
                  aria-invalid={r.error ? true : undefined}
                  aria-describedby={
                    r.error || r.saveError ? `${inputId}-err` : undefined
                  }
                  onFocus={(e) => {
                    setFocusedId(r.id);
                    // ソフトウェアキーボードで隠れないように、入力欄を見える位置へ
                    const el = e.currentTarget;
                    setTimeout(
                      () => el.scrollIntoView?.({ block: "center" }),
                      300,
                    );
                  }}
                  onChange={(e) => {
                    const value = e.target.value;
                    patchRow(r.id, {
                      value,
                      justSaved: false,
                      // エラー中は入力のたびに再判定し、直れば解消する
                      ...(r.error
                        ? { error: validateValue(r.value_type, r.key, value) }
                        : {}),
                    });
                    // 日付は選んだ時点で保存する
                    if (r.value_type === "date") void saveRow(r.id);
                  }}
                  onBlur={() => {
                    setFocusedId((f) => (f === r.id ? null : f));
                    void saveRow(r.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing)
                      e.currentTarget.blur();
                  }}
                />
                {r.unit && <span className={styles.unit}>{r.unit}</span>}
              </div>
              {(r.error ?? r.saveError) && (
                <div
                  id={`${inputId}-err`}
                  className={styles.error}
                  role="alert"
                >
                  {r.error ?? r.saveError}
                </div>
              )}
            </div>
          );
        })}
    </section>
  );
}
