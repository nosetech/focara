"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiFetch } from "@/lib/api";
import {
  PRIORITIES,
  filterInbox,
  formatEstimate,
  priorityLabel,
} from "@/lib/inbox";
import {
  LIST_COPY,
  SLOT_LABEL,
  WEEKDAY_LABELS,
  formatWaitUntil,
  recentHistory,
  recurrenceLabel,
  ruleBody,
  toLocalInput,
  toRuleDraft,
  toggleWeekday,
  waitBody,
  type ListStatus,
  type ListTask,
  type RuleDraft,
} from "@/lib/statusList";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import { TaskDetail } from "./TaskDetail";
import styles from "./InboxScreen.module.css";
import extra from "./StatusListScreen.module.css";

type Load = "loading" | "error" | "ready";
type Log = { task_title: string; action: string; created_at: string };

/** 整理画面の条件待ち・いつか・習慣。一覧と、待ち条件・繰り返しルールの編集、次にやるへの復帰。 */
export function StatusListScreen({ status }: { status: ListStatus }) {
  const { filters, clearFilters, projects, panelEl, refreshCounts, showToast } =
    useOrganize();
  const copy = LIST_COPY[status];
  const [tasks, setTasks] = useState<ListTask[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [selId, setSelId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [today] = useState(() => new Date());
  const busy = useRef(false);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        const list = await apiFetch<ListTask[]>("/tasks", {
          query: { status },
        });
        if (status === "habit") {
          const from = new Date();
          from.setDate(from.getDate() - 6);
          const p = (n: number) => String(n).padStart(2, "0");
          setLogs(
            await apiFetch<Log[]>("/logs", {
              query: {
                action: "completed",
                from_date: `${from.getFullYear()}-${p(from.getMonth() + 1)}-${p(from.getDate())}`,
              },
            }),
          );
        }
        setTasks(list);
        setLoad("ready");
      } catch {
        if (initial) setLoad("error");
        else showToast({ msg: "更新できませんでした。もう一度お試しください" });
      }
    },
    [status, showToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll(true);
  }, [fetchAll]);

  const projectName = useCallback(
    (id: number | null) => projects.find((p) => p.id === id)?.name ?? "",
    [projects],
  );
  const rows = useMemo(
    () => filterInbox(tasks, filters, projectName),
    [tasks, filters, projectName],
  );
  const current = rows.find((t) => t.id === selId) ?? null;

  const patchLocal = (id: number, patch: Partial<ListTask>) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** 保存。成功したら true。 */
  const save = async (
    id: number,
    path: string,
    method: string,
    body?: Record<string, unknown>,
  ) => {
    try {
      patchLocal(id, await apiFetch<ListTask>(path, { method, body }));
      return true;
    } catch {
      showToast({ msg: "保存できませんでした。もう一度お試しください" });
      return false;
    }
  };
  const patchTask = (id: number, body: Record<string, unknown>) =>
    save(id, `/tasks/${id}`, "PATCH", body);

  /** 次にやるへ戻す(元のステータスへ戻すundo付き)。 */
  const returnToNext = async (t: ListTask) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await apiFetch(`/tasks/${t.id}/transition`, {
        method: "POST",
        body: { status: "next" },
      });
      setTasks((ts) => ts.filter((x) => x.id !== t.id));
      setSelId(null);
      refreshCounts();
      showToast({
        msg: "1件を「次にやる」へ戻しました",
        undo: () => {
          void apiFetch(`/tasks/${t.id}/transition`, {
            method: "POST",
            body:
              status === "waiting"
                ? {
                    status,
                    wait_condition: t.wait_condition,
                    wait_until: t.wait_until,
                  }
                : { status },
          }).then(() => {
            void fetchAll(false);
            refreshCounts();
          });
        },
      });
    } catch {
      showToast({ msg: "移動できませんでした。もう一度お試しください" });
    } finally {
      busy.current = false;
    }
  };

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return (
      <OrganizeError label={copy.label} onRetry={() => void fetchAll(true)} />
    );

  const panel = current && (
    <div className={styles.panelBody}>
      <div className={styles.panelTitle}>{current.title}</div>
      {status === "waiting" && (
        <WaitEditor
          key={`${current.id}:${current.wait_condition}:${current.wait_until}`}
          task={current}
          onSave={(body) => patchTask(current.id, body)}
          onError={(msg) => showToast({ msg })}
        />
      )}
      {status === "habit" && (
        <RuleEditor
          key={`${current.id}:${recurrenceLabel(current)}:${current.recurrence_end_type}`}
          task={current}
          onSave={(body) =>
            save(current.id, `/tasks/${current.id}/recurrence`, "PUT", body)
          }
          onStop={() =>
            save(current.id, `/tasks/${current.id}/recurrence`, "DELETE")
          }
          onError={(msg) => showToast({ msg })}
        />
      )}
      <section className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="list-project">
          プロジェクト
        </label>
        <select
          id="list-project"
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
          {[...PRIORITIES, { value: null, label: "なし" }].map((p) => (
            <button
              key={p.label}
              className={styles.segment}
              aria-pressed={current.priority === p.value}
              onClick={() => void patchTask(current.id, { priority: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="list-estimate">
          見積もり時間(分)
        </label>
        <input
          key={`${current.id}:${current.estimate_minutes ?? ""}`}
          id="list-estimate"
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
      <section className={styles.field}>
        <div className={styles.segments}>
          <button
            className={styles.segment}
            onClick={() => void returnToNext(current)}
          >
            次にやるへ戻す
          </button>
          <button
            className={styles.segment}
            onClick={() => setDetailId(current.id)}
          >
            詳細を編集
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <>
      {detailId != null && (
        <TaskDetail
          key={detailId}
          taskId={detailId}
          onClose={() => {
            setDetailId(null);
            void fetchAll(false);
            refreshCounts();
          }}
        />
      )}

      {rows.length === 0 ? (
        tasks.length === 0 ? (
          <div className={styles.empty}>
            <OrganizeEmpty title={copy.emptyTitle} text={copy.emptyText} />
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
          {rows.map((t) => {
            const hist =
              status === "habit" ? recentHistory(t.title, logs, today) : [];
            const doneCount = hist.filter((x) => x === 1).length;
            const total = hist.filter((x) => x !== null).length;
            return (
              <li
                key={t.id}
                className={styles.row}
                data-focused={current?.id === t.id ? "" : undefined}
                onClick={() => setSelId(t.id)}
              >
                <div className={styles.body}>
                  <div className={styles.title}>{t.title}</div>
                  <div className={styles.meta}>
                    {status === "habit" && (
                      <span>
                        {recurrenceLabel(t)} ·{" "}
                        {t.time_slot ? SLOT_LABEL[t.time_slot] : "枠なし"}
                      </span>
                    )}
                    {projectName(t.project_id) && (
                      <span>{projectName(t.project_id)}</span>
                    )}
                    {status === "someday" && t.priority && (
                      <span>優先度 {priorityLabel(t.priority)}</span>
                    )}
                    {status === "someday" && t.estimate_minutes ? (
                      <span className={styles.mono}>
                        {formatEstimate(t.estimate_minutes)}
                      </span>
                    ) : null}
                    {status === "habit" && (
                      <span>
                        直近7日 {doneCount}/{total}
                      </span>
                    )}
                  </div>
                  {status === "waiting" && (
                    <div className={extra.note}>
                      条件: {t.wait_condition || "未設定"}
                      {t.wait_until && ` · ${formatWaitUntil(t.wait_until)}`}
                    </div>
                  )}
                  {status === "habit" && (
                    <div className={extra.dots} aria-hidden="true">
                      {hist.map((x, i) => (
                        <i
                          key={i}
                          data-state={
                            x === 1 ? "done" : x === 0 ? "miss" : "today"
                          }
                          title={
                            x === 1
                              ? "実施"
                              : x === 0
                                ? "未実施"
                                : "今日(未実施)"
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.action}
                    onClick={(e) => {
                      e.stopPropagation();
                      void returnToNext(t);
                    }}
                  >
                    {status === "waiting" ? "次にやるへ戻す" : "次にやるへ"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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

function WaitEditor({
  task,
  onSave,
  onError,
}: {
  task: ListTask;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onError: (msg: string) => void;
}) {
  const [cond, setCond] = useState(task.wait_condition ?? "");
  const [until, setUntil] = useState(toLocalInput(task.wait_until));
  const dirty =
    cond !== (task.wait_condition ?? "") ||
    until !== toLocalInput(task.wait_until);
  return (
    <section className={styles.field}>
      <label className={styles.fieldLabel} htmlFor="wait-cond">
        待ち条件(相手・出来事)
      </label>
      <input
        id="wait-cond"
        className={styles.input}
        value={cond}
        placeholder="例: 〇〇さんからの返信"
        onChange={(e) => setCond(e.target.value)}
      />
      <label className={styles.fieldLabel} htmlFor="wait-until">
        待ち日時(この日時に自動で「次にやる」へ戻ります)
      </label>
      <input
        id="wait-until"
        className={styles.input}
        type="datetime-local"
        value={until}
        onChange={(e) => setUntil(e.target.value)}
      />
      <div className={styles.segments}>
        <button
          className={styles.segment}
          disabled={!dirty}
          onClick={() => {
            const body = waitBody(cond, until);
            if ("error" in body) onError(body.error);
            else void onSave(body);
          }}
        >
          待ち条件を保存
        </button>
      </div>
    </section>
  );
}

function RuleEditor({
  task,
  onSave,
  onStop,
  onError,
}: {
  task: ListTask;
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
  onStop: () => Promise<boolean>;
  onError: (msg: string) => void;
}) {
  const [d, setD] = useState<RuleDraft>(() => toRuleDraft(task));
  const set = (p: Partial<RuleDraft>) => setD({ ...d, ...p });
  const active = task.recurrence_type !== null;
  return (
    <section className={styles.field}>
      <div className={styles.fieldLabel}>
        繰り返し: {recurrenceLabel(task)}
        {!active && "(停止中)"}
      </div>
      <div className={styles.segments}>
        {(
          [
            ["weekly", "毎週"],
            ["monthly", "毎月"],
            ["yearly", "毎年"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            className={styles.segment}
            aria-pressed={d.type === k}
            onClick={() => set({ type: k })}
          >
            {l}
          </button>
        ))}
      </div>
      {d.type === "weekly" && (
        <div className={styles.segments}>
          {WEEKDAY_LABELS.map((l, i) => (
            <button
              key={l}
              className={`${styles.segment} ${extra.day}`}
              aria-pressed={((d.weekdays >> i) & 1) === 1}
              onClick={() => set({ weekdays: toggleWeekday(d.weekdays, i) })}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {d.type === "monthly" && (
        <label className={extra.inline}>
          日にち(-1 で月末)
          <input
            className={styles.input}
            inputMode="numeric"
            value={d.monthDay}
            onChange={(e) => set({ monthDay: e.target.value })}
          />
        </label>
      )}
      {d.type === "yearly" && (
        <div className={extra.inline}>
          <input
            className={styles.input}
            aria-label="月"
            inputMode="numeric"
            value={d.month}
            onChange={(e) => set({ month: e.target.value })}
          />
          月
          <input
            className={styles.input}
            aria-label="日"
            inputMode="numeric"
            value={d.day}
            onChange={(e) => set({ day: e.target.value })}
          />
          日
        </div>
      )}
      <div className={styles.fieldLabel}>終了条件</div>
      <div className={styles.segments}>
        {(
          [
            ["none", "なし"],
            ["date", "日付"],
            ["count", "回数"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            className={styles.segment}
            aria-pressed={d.endType === k}
            onClick={() => set({ endType: k })}
          >
            {l}
          </button>
        ))}
      </div>
      {d.endType === "date" && (
        <input
          className={styles.input}
          type="date"
          aria-label="終了日"
          value={d.endDate}
          onChange={(e) => set({ endDate: e.target.value })}
        />
      )}
      {d.endType === "count" && (
        <label className={extra.inline}>
          <input
            className={styles.input}
            inputMode="numeric"
            aria-label="回数"
            value={d.endCount}
            onChange={(e) => set({ endCount: e.target.value })}
          />
          回で終了
        </label>
      )}
      <div className={styles.segments}>
        <button
          className={styles.segment}
          onClick={() => {
            const rule = ruleBody(d);
            if ("error" in rule) onError(rule.error);
            else void onSave(rule.body);
          }}
        >
          ルールを保存
        </button>
        {active && (
          <button className={styles.segment} onClick={() => void onStop()}>
            繰り返しを停止
          </button>
        )}
      </div>
    </section>
  );
}
