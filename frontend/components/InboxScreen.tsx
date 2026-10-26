"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import {
  PRIORITIES,
  TRIAGE_STATUSES,
  filterInbox,
  formatAdded,
  formatEstimate,
  nextFocus,
  priorityLabel,
  transitionBody,
  type InboxTask,
} from "@/lib/inbox";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import { TASK_ADDED_EVENT } from "./QuickAdd";
import styles from "./InboxScreen.module.css";

type Load = "loading" | "error" | "ready";

const STATUS_LABEL = Object.fromEntries(
  TRIAGE_STATUSES.map((s) => [s.status, s.label]),
);

/** 整理画面の inbox。1件ずつ・まとめてステータスを振り分け、プロジェクト・優先度・見積もりを設定する。 */
export function InboxScreen() {
  const {
    filters,
    clearFilters,
    projects,
    panelEl,
    refreshCounts,
    showToast,
    openQuickAdd,
  } = useOrganize();
  const [tasks, setTasks] = useState<InboxTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [focus, setFocus] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [waitFor, setWaitFor] = useState<number[] | null>(null);
  const [waitText, setWaitText] = useState("");
  const busy = useRef(false);

  const fetchTasks = useCallback(async (initial: boolean) => {
    if (initial) setLoad("loading");
    try {
      const list = await apiFetch<InboxTask[]>("/tasks", {
        query: { status: "inbox" },
      });
      setTasks(list);
      setLoad("ready");
    } catch {
      if (initial) setLoad("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchTasks(true);
    const onAdded = () => {
      void fetchTasks(false);
      refreshCounts();
    };
    window.addEventListener(TASK_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(TASK_ADDED_EVENT, onAdded);
  }, [fetchTasks, refreshCounts]);

  const projectName = useCallback(
    (id: number | null) => projects.find((p) => p.id === id)?.name ?? "",
    [projects],
  );
  const rows = useMemo(
    () => filterInbox(tasks, filters, projectName),
    [tasks, filters, projectName],
  );
  const current = rows[Math.min(focus, rows.length - 1)] ?? null;

  const patchLocal = (id: number, patch: Partial<InboxTask>) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** ステータスを振り分ける。成功したタスクは inbox から消える。 */
  const assign = useCallback(
    async (ids: number[], status: string, waitCondition?: string) => {
      if (ids.length === 0 || busy.current) return;
      if (status === "waiting" && !waitCondition?.trim()) {
        setWaitText("");
        setWaitFor(ids);
        return;
      }
      busy.current = true;
      setWaitFor(null);
      const results = await Promise.allSettled(
        ids.map((id) =>
          apiFetch(`/tasks/${id}/transition`, {
            method: "POST",
            body: transitionBody(status, waitCondition),
          }),
        ),
      );
      busy.current = false;
      const done = ids.filter((_, i) => results[i].status === "fulfilled");
      const failed = ids.length - done.length;
      if (done.length > 0) {
        const remaining = rows.filter((t) => !done.includes(t.id)).length;
        setTasks((ts) => ts.filter((t) => !done.includes(t.id)));
        setChecked([]);
        setFocus((f) => nextFocus(f, remaining));
        refreshCounts();
        showToast({
          msg: `${done.length}件を「${STATUS_LABEL[status]}」へ移動しました${failed ? `(${failed}件は失敗)` : ""}`,
          undo: () => {
            void Promise.allSettled(
              done.map((id) =>
                apiFetch(`/tasks/${id}/transition`, {
                  method: "POST",
                  body: { status: "inbox" },
                }),
              ),
            ).then(() => {
              void fetchTasks(false);
              refreshCounts();
            });
          },
        });
      } else {
        showToast({ msg: "移動できませんでした。もう一度お試しください" });
      }
    },
    [rows, refreshCounts, showToast, fetchTasks],
  );

  const patchTask = async (id: number, body: Record<string, unknown>) => {
    const before = tasks.find((t) => t.id === id);
    try {
      const updated = await apiFetch<InboxTask>(`/tasks/${id}`, {
        method: "PATCH",
        body,
      });
      patchLocal(id, updated);
    } catch {
      if (before) patchLocal(id, before);
      showToast({ msg: "保存できませんでした。もう一度お試しください" });
    }
  };

  const bulkPatch = async (ids: number[], body: Record<string, unknown>) => {
    const results = await Promise.allSettled(
      ids.map((id) =>
        apiFetch<InboxTask>(`/tasks/${id}`, { method: "PATCH", body }),
      ),
    );
    results.forEach((r, i) => {
      if (r.status === "fulfilled") patchLocal(ids[i], r.value);
    });
    const failed = results.filter((r) => r.status === "rejected").length;
    showToast({
      msg: failed
        ? `${failed}件を設定できませんでした`
        : `${ids.length}件を設定しました`,
    });
  };

  const targets = checked.length > 0 ? checked : current ? [current.id] : [];

  // キーボード操作(デスクトップ)。入力中は無視する
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") {
        setChecked([]);
        setWaitFor(null);
        return;
      }
      if (rows.length === 0 || waitFor) return;
      const at = Math.min(focus, rows.length - 1);
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocus(Math.min(rows.length - 1, at + 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocus(Math.max(0, at - 1));
      } else if (e.key === "x" || e.key === " ") {
        e.preventDefault();
        const id = rows[at].id;
        setChecked((c) =>
          c.includes(id) ? c.filter((x) => x !== id) : [...c, id],
        );
      } else if (["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        void assign(targets, TRIAGE_STATUSES[Number(e.key) - 1].status);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return (
      <OrganizeError label="inbox" onRetry={() => void fetchTasks(true)} />
    );

  const panel = current && (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>{current.title}</div>
      <section className={styles.field}>
        <div className={styles.fieldLabel}>ステータス</div>
        <div className={styles.segments}>
          {TRIAGE_STATUSES.map((s) => (
            <button
              key={s.status}
              className={styles.segment}
              onClick={() => void assign([current.id], s.status)}
            >
              <kbd>{s.key}</kbd>
              {s.label}
            </button>
          ))}
        </div>
      </section>
      <section className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="inbox-project">
          プロジェクト
        </label>
        <select
          id="inbox-project"
          className={styles.select}
          value={current.project_id ?? ""}
          onChange={(e) =>
            void patchTask(current.id, {
              project_id: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">なし</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </section>
      <section className={styles.field}>
        <div className={styles.fieldLabel}>優先度</div>
        <div className={styles.segments}>
          {[...PRIORITIES.map((p) => p), { value: null, label: "なし" }].map(
            (p) => (
              <button
                key={p.label}
                className={styles.segment}
                aria-pressed={current.priority === p.value}
                onClick={() =>
                  void patchTask(current.id, { priority: p.value })
                }
              >
                {p.label}
              </button>
            ),
          )}
        </div>
      </section>
      <section className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="inbox-estimate">
          見積もり時間(分)
        </label>
        <input
          key={`${current.id}:${current.estimate_minutes ?? ""}`}
          id="inbox-estimate"
          className={styles.input}
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={current.estimate_minutes ?? ""}
          onBlur={(e) => {
            const v = e.target.value.trim();
            const next = v === "" ? null : Math.max(0, Math.floor(Number(v)));
            if (next !== current.estimate_minutes && !Number.isNaN(next))
              void patchTask(current.id, { estimate_minutes: next });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </section>
    </div>
  );

  return (
    <>
      {waitFor && (
        <form
          className={styles.wait}
          onSubmit={(e) => {
            e.preventDefault();
            void assign(waitFor, "waiting", waitText);
          }}
        >
          <label htmlFor="inbox-wait">{waitFor.length}件の待ち条件</label>
          <input
            id="inbox-wait"
            className={styles.input}
            autoFocus
            value={waitText}
            placeholder="例: 〇〇さんからの返信"
            onChange={(e) => setWaitText(e.target.value)}
          />
          <button
            className={styles.primary}
            type="submit"
            disabled={!waitText.trim()}
          >
            条件待ちにする
          </button>
          <button
            className={styles.link}
            type="button"
            onClick={() => setWaitFor(null)}
          >
            キャンセル
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        tasks.length === 0 ? (
          <div className={styles.empty}>
            <OrganizeEmpty
              title="整理済みです"
              text="inboxは空です。思いついたことは N キーか「inboxに追加」から、いつでも放り込めます。"
            />
            <button className={styles.outline} onClick={openQuickAdd}>
              inboxに追加
            </button>
          </div>
        ) : (
          <div className={styles.empty}>
            <OrganizeEmpty
              title="条件に合うタスクはありません"
              text="絞り込みを変えるか、解除してください。"
            />
            <button className={styles.outline} onClick={clearFilters}>
              絞り込みを解除
            </button>
          </div>
        )
      ) : (
        <ul className={styles.list}>
          {rows.map((t, i) => {
            const on = checked.includes(t.id);
            const focused = current?.id === t.id;
            return (
              <li
                key={t.id}
                className={styles.row}
                data-focused={focused ? "" : undefined}
                onClick={() => setFocus(i)}
              >
                <button
                  className={styles.check}
                  aria-label="選択"
                  aria-pressed={on}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChecked((c) =>
                      on ? c.filter((x) => x !== t.id) : [...c, t.id],
                    );
                  }}
                >
                  <span data-on={on ? "" : undefined}>
                    {on && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                </button>
                <div className={styles.body}>
                  <div className={styles.title}>{t.title}</div>
                  <div className={styles.meta}>
                    {projectName(t.project_id) && (
                      <span>{projectName(t.project_id)}</span>
                    )}
                    {t.priority && (
                      <span>優先度 {priorityLabel(t.priority)}</span>
                    )}
                    {t.estimate_minutes ? (
                      <span className={styles.mono}>
                        {formatEstimate(t.estimate_minutes)}
                      </span>
                    ) : null}
                    <span>追加 {formatAdded(t.created_at)}</span>
                  </div>
                </div>
                {focused && (
                  <div className={styles.actions}>
                    {TRIAGE_STATUSES.map((s) => (
                      <button
                        key={s.status}
                        className={styles.action}
                        onClick={(e) => {
                          e.stopPropagation();
                          void assign([t.id], s.status);
                        }}
                      >
                        <kbd>{s.key}</kbd>
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {checked.length > 0 && (
        <div className={styles.bulk}>
          <span className={styles.bulkCount}>
            <b>{checked.length}</b>件を選択
          </span>
          {TRIAGE_STATUSES.map((s) => (
            <button
              key={s.status}
              className={styles.action}
              onClick={() => void assign(checked, s.status)}
            >
              <kbd>{s.key}</kbd>
              {s.label}
            </button>
          ))}
          <select
            className={styles.select}
            value=""
            aria-label="プロジェクトを設定"
            onChange={(e) => {
              if (e.target.value)
                void bulkPatch(checked, { project_id: Number(e.target.value) });
            }}
          >
            <option value="">プロジェクトを設定</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className={styles.clear} onClick={() => setChecked([])}>
            選択を解除
          </button>
        </div>
      )}

      {panelEl &&
        createPortal(
          panel || (
            <div className={styles.panelEmpty}>
              行を選択すると
              <br />
              ここに詳細が表示されます
            </div>
          ),
          panelEl,
        )}
    </>
  );
}
