"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import {
  PROPERTY_TYPES,
  SAVE_LABEL,
  newDraft,
  propertyBody,
  toDraft,
  type PropertyDraft,
  type PropertyType,
  type SaveState,
  type TaskProperty,
} from "@/lib/taskDetail";
import styles from "./TaskDetail.module.css";

const MEMO_DEBOUNCE_MS = 800;

interface TaskData {
  id: number;
  title: string;
  memo: string | null;
}

type Load =
  { state: "loading" } | { state: "error" } | { state: "ready"; title: string };

/** 実行画面のタスクをタップしたときに開く詳細(モバイルはボトムシート、デスクトップは右パネル)。 */
export function TaskDetail({
  taskId,
  onClose,
}: {
  taskId: number;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<PropertyDraft[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>("saved");

  const seq = useRef(0);
  const pending = useRef(0);
  const failed = useRef(new Map<string, () => Promise<void>>());
  const memoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const memoDirty = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const [task, props] = await Promise.all([
        apiFetch<TaskData>(`/tasks/${taskId}`),
        apiFetch<TaskProperty[]>(`/tasks/${taskId}/properties`),
      ]);
      setMemo(task.memo ?? "");
      setRows(props.map(toDraft));
      setLoad({ state: "ready", title: task.title });
    } catch {
      setLoad({ state: "error" });
    }
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  /** 保存を1件実行する。同じ name の保存は失敗時に再試行用として最新のものだけ残す。 */
  const run = useCallback(async (name: string, fn: () => Promise<void>) => {
    pending.current += 1;
    setSave("saving");
    try {
      await fn();
      failed.current.delete(name);
    } catch {
      failed.current.set(name, fn);
    } finally {
      pending.current -= 1;
      if (pending.current === 0)
        setSave(failed.current.size > 0 ? "error" : "saved");
    }
  }, []);

  const putMemo = useCallback(
    (value: string) =>
      run("memo", async () => {
        await apiFetch(`/tasks/${taskId}/memo`, {
          method: "PUT",
          body: { memo: value === "" ? null : value },
        });
        if (memoDirty.current === value) memoDirty.current = null;
      }),
    [run, taskId],
  );

  const flushMemo = useCallback(() => {
    clearTimeout(memoTimer.current);
    if (memoDirty.current !== null) void putMemo(memoDirty.current);
  }, [putMemo]);

  const onMemo = (value: string) => {
    setMemo(value);
    memoDirty.current = value;
    clearTimeout(memoTimer.current);
    memoTimer.current = setTimeout(flushMemo, MEMO_DEBOUNCE_MS);
  };

  // 閉じる・タスク切替時に未送信のメモを送る
  useEffect(() => {
    return () => {
      clearTimeout(memoTimer.current);
      if (memoDirty.current !== null)
        void apiFetch(`/tasks/${taskId}/memo`, {
          method: "PUT",
          body: { memo: memoDirty.current === "" ? null : memoDirty.current },
        }).catch(() => {});
    };
  }, [taskId]);

  const clearRowError = (localId: string) =>
    setRowErrors((e) => {
      const rest = { ...e };
      delete rest[localId];
      return rest;
    });

  const patchRow = (localId: string, patch: Partial<PropertyDraft>) =>
    setRows((rs) =>
      rs.map((r) => (r.localId === localId ? { ...r, ...patch } : r)),
    );

  /** 行を保存する。新規はPOST、既存はPATCHし、返ってきた id を行に反映する。 */
  const saveRow = (draft: PropertyDraft) => {
    const body = propertyBody(draft);
    clearRowError(draft.localId);
    if (body === null) return;
    if ("error" in body) {
      setRowErrors((e) => ({ ...e, [draft.localId]: body.error }));
      return;
    }
    void run(draft.localId, async () => {
      try {
        const saved =
          draft.id == null
            ? await apiFetch<TaskProperty>(`/tasks/${taskId}/properties`, {
                method: "POST",
                body,
              })
            : await apiFetch<TaskProperty>(
                `/tasks/${taskId}/properties/${draft.id}`,
                { method: "PATCH", body },
              );
        // 再試行で二重にPOSTしないよう、保存後は id を引き継いだ関数に差し替える
        draft = { ...draft, id: saved.id };
        patchRow(draft.localId, { id: saved.id });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409)
          setRowErrors((x) => ({
            ...x,
            [draft.localId]: "同じ名前のプロパティがあります",
          }));
        throw e;
      }
    });
  };

  const removeRow = (draft: PropertyDraft) => {
    setRows((rs) => rs.filter((r) => r.localId !== draft.localId));
    clearRowError(draft.localId);
    failed.current.delete(draft.localId);
    if (draft.id == null) return;
    const id = draft.id;
    void run(draft.localId, async () => {
      await apiFetch(`/tasks/${taskId}/properties/${id}`, { method: "DELETE" });
    });
  };

  const retry = () => {
    if (failed.current.size === 0) setSave("saved");
    for (const [name, fn] of [...failed.current.entries()]) void run(name, fn);
  };

  const close = () => {
    flushMemo();
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} onClick={close} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="タスクの詳細"
      >
        <div className={styles.grabber} />
        <div className={styles.top}>
          <div className={styles.save} data-state={save} role="status">
            <span className={styles.saveDot} />
            <span>{SAVE_LABEL[save]}</span>
            {save === "error" && (
              <button className={styles.retry} onClick={retry}>
                再試行
              </button>
            )}
          </div>
          <button className={styles.close} onClick={close} aria-label="閉じる">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {load.state === "loading" && (
          <div
            className={styles.skeleton}
            aria-busy="true"
            aria-label="読み込み中"
          >
            <i style={{ height: 24, width: "80%" }} />
            <i style={{ height: 14, width: "70%", marginTop: 16 }} />
            <i style={{ height: 96, marginTop: 8, borderRadius: 10 }} />
            <i style={{ height: 36, marginTop: 8 }} />
          </div>
        )}

        {load.state === "error" && (
          <div className={styles.loadError} role="alert">
            <p>詳細を読み込めませんでした。</p>
            <button className={styles.primary} onClick={() => void fetchAll()}>
              再試行
            </button>
          </div>
        )}

        {load.state === "ready" && (
          <div className={styles.body}>
            {save === "error" && (
              <div className={styles.alert} role="alert">
                変更がまだ保存されていません。「再試行」で送り直せます。
              </div>
            )}
            <h2 className={styles.title}>{load.title}</h2>

            <div className={styles.labelRow}>
              <span className={styles.label}>メモ</span>
              <span className={styles.hint}>Markdown</span>
            </div>
            <textarea
              className={styles.memo}
              value={memo}
              rows={5}
              placeholder="経緯、手順、リンクなど"
              onChange={(e) => onMemo(e.target.value)}
              onBlur={flushMemo}
            />

            <div className={styles.label} style={{ marginTop: 20 }}>
              カスタムプロパティ
            </div>
            <div className={styles.props}>
              {rows.map((r) => (
                <div key={r.localId} className={styles.prop}>
                  <div className={styles.propRow}>
                    <input
                      className={styles.input}
                      style={{ width: 110 }}
                      value={r.key}
                      placeholder="名前"
                      aria-label="プロパティ名"
                      onChange={(e) =>
                        patchRow(r.localId, { key: e.target.value })
                      }
                      onBlur={() => saveRow(r)}
                    />
                    {r.value_type === "date" ? (
                      <input
                        type="date"
                        className={`${styles.input} ${styles.mono}`}
                        style={{ flex: 1, minWidth: 0 }}
                        value={r.value}
                        aria-label="値"
                        onChange={(e) => {
                          patchRow(r.localId, { value: e.target.value });
                          saveRow({ ...r, value: e.target.value });
                        }}
                      />
                    ) : (
                      <input
                        className={`${styles.input} ${styles.mono}`}
                        style={{ flex: 1, minWidth: 0 }}
                        value={r.value}
                        inputMode={
                          r.value_type === "number" ? "decimal" : undefined
                        }
                        placeholder="値"
                        aria-label="値"
                        onChange={(e) =>
                          patchRow(r.localId, { value: e.target.value })
                        }
                        onBlur={() => saveRow(r)}
                      />
                    )}
                    <button
                      className={styles.remove}
                      aria-label="削除"
                      onClick={() => removeRow(r)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <div className={styles.propRow}>
                    <div className={styles.seg} role="group" aria-label="種別">
                      {PROPERTY_TYPES.map((t) => (
                        <button
                          key={t.key}
                          data-on={r.value_type === t.key ? "" : undefined}
                          onClick={() => {
                            // 種別を変えると値の形式が合わなくなるため、値と単位は空に戻す。
                            // 値を入れ直して確定するまでは保存しない
                            patchRow(r.localId, {
                              value_type: t.key as PropertyType,
                              value: "",
                              unit: "",
                            });
                            clearRowError(r.localId);
                          }}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {r.value_type === "number" && (
                      <input
                        className={styles.input}
                        style={{ width: 72 }}
                        value={r.unit}
                        placeholder="単位"
                        aria-label="単位"
                        onChange={(e) =>
                          patchRow(r.localId, { unit: e.target.value })
                        }
                        onBlur={() => saveRow(r)}
                      />
                    )}
                  </div>
                  {rowErrors[r.localId] && (
                    <div className={styles.rowError} role="alert">
                      {rowErrors[r.localId]}
                    </div>
                  )}
                </div>
              ))}
              <button
                className={styles.add}
                onClick={() => {
                  seq.current += 1;
                  setRows((rs) => [...rs, newDraft(seq.current)]);
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                プロパティを追加
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
