"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  SLOTS,
  SLOT_LABEL,
  buildRunView,
  currentSlot,
  formatClock,
  formatDateLabel,
  formatMinutes,
  toDateParam,
  type RunTask,
  type TimeSlot,
} from "@/lib/run";
import styles from "./RunScreen.module.css";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; tasks: RunTask[]; projects: Map<number, string> };

const MAX_UPCOMING = 6;

function estimate(t: RunTask) {
  return t.estimate_minutes != null ? `${t.estimate_minutes}分` : "";
}

export function RunScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [now, setNow] = useState<Date | null>(null);

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    const today = new Date();
    try {
      const [tasks, projects] = await Promise.all([
        apiFetch<RunTask[]>("/schedule", {
          query: { date: toDateParam(today), include_done: true },
        }),
        apiFetch<{ id: number; name: string }[]>("/projects"),
      ]);
      setLoad({
        state: "ready",
        tasks,
        projects: new Map(projects.map((p) => [p.id, p.name])),
      });
    } catch {
      setLoad({ state: "error" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    void fetchAll();
  }, [fetchAll]);

  const slot: TimeSlot | null = now ? currentSlot(now) : null;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.date}>{now ? formatDateLabel(now) : ""}</div>
        <div className={styles.slotMarks}>
          {SLOTS.map((s) => (
            <span key={s.key} data-on={s.key === slot ? "" : undefined}>
              {s.label}
            </span>
          ))}
        </div>
      </header>
      {load.state === "loading" && <Loading />}
      {load.state === "error" && <ErrorView onRetry={fetchAll} />}
      {load.state === "ready" && (
        <Ready tasks={load.tasks} projects={load.projects} slot={slot} />
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="読み込み中">
      <i style={{ height: 3, width: "100%" }} />
      <i style={{ height: 12, width: 110, marginTop: 52 }} />
      <i style={{ height: 28, width: 300, marginTop: 16 }} />
      <i style={{ height: 28, width: 190, marginTop: 12 }} />
      <i style={{ height: 26, width: 120, marginTop: 22, borderRadius: 999 }} />
      <i style={{ height: 14, width: 240, marginTop: 64 }} />
      <i style={{ height: 14, width: 200, marginTop: 22 }} />
    </div>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.message} role="alert">
      <h1>タスクを読み込めませんでした</h1>
      <p>
        通信が不安定な可能性があります。接続を確認して、もう一度お試しください。
      </p>
      <button className={styles.primary} onClick={onRetry}>
        再試行
      </button>
    </div>
  );
}

function Ready({
  tasks,
  projects,
  slot,
}: {
  tasks: RunTask[];
  projects: Map<number, string>;
  slot: TimeSlot | null;
}) {
  const view = buildRunView(tasks);
  const cur = view.queue[0];

  if (view.total === 0) {
    return (
      <div className={styles.message}>
        <h1>今日の予定はありません</h1>
        <p>今日やるものを選びましょう。</p>
        <Link href="/organize" className={styles.primary}>
          inboxを整理する
        </Link>
      </div>
    );
  }

  if (!cur) {
    return (
      <div className={styles.message}>
        <div className={styles.eyebrow}>夜の枠が終わりました</div>
        <h1>今日の予定をすべて終えました</h1>
        <div className={styles.counts}>
          <div>
            <b>{view.done.length}</b>
            <span>完了</span>
          </div>
          <div>
            <b className={styles.dim}>0</b>
            <span>未完了</span>
          </div>
        </div>
        <p>おつかれさまでした。やったことは今日の記録に残っています。</p>
      </div>
    );
  }

  const rest = view.queue.slice(1);
  const shown = rest.slice(0, MAX_UPCOMING);
  const pct = Math.round((view.done.length / view.total) * 100);
  const chips: { label: string; accent?: boolean; mono?: boolean }[] = [];
  if (cur.fixed_at)
    chips.push({
      label: `${formatClock(cur.fixed_at)}〜`,
      accent: true,
      mono: true,
    });
  if (cur.time_slot) chips.push({ label: SLOT_LABEL[cur.time_slot] });
  if (cur.priority != null) chips.push({ label: `優先度 ${cur.priority}` });
  if (cur.estimate_minutes != null) chips.push({ label: estimate(cur) });
  if (cur.memo) chips.push({ label: "メモあり" });

  const upcoming: React.ReactNode[] = [];
  let prev = cur.time_slot;
  shown.forEach((t) => {
    if (t.time_slot !== prev) {
      prev = t.time_slot;
      upcoming.push(
        <div key={`h${t.id}`} className={styles.slotHeader}>
          {t.time_slot ? SLOT_LABEL[t.time_slot] : "時間帯なし"}
          <span />
        </div>,
      );
    }
    upcoming.push(
      <div
        key={t.id}
        className={styles.upRow}
        style={{ opacity: t === shown[0] ? 0.82 : 0.46 }}
      >
        <span className={styles.upTitle}>{t.title}</span>
        {t.fixed_at && (
          <span className={styles.mono} style={{ color: "var(--accent)" }}>
            {formatClock(t.fixed_at)}
          </span>
        )}
        <span className={styles.est}>{estimate(t)}</span>
      </div>,
    );
  });

  // デスクトップの「今日の流れ」(完了済みを含め時間帯ごと)
  const flow = SLOTS.map((s) => {
    const g = tasks.filter((t) => t.time_slot === s.key);
    return { ...s, tasks: g };
  }).filter((s) => s.tasks.length);

  return (
    <div className={styles.runLayout}>
      <div className={styles.runMain}>
        <div className={styles.progress}>
          <div className={styles.bar}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className={styles.progressText}>
            <span>
              <span className={styles.mono}>
                {view.done.length}/{view.total}
              </span>{" "}
              完了
            </span>
            <span>
              残り{" "}
              <span className={styles.mono}>
                約{formatMinutes(view.remainMinutes)}
              </span>
            </span>
          </div>
        </div>

        <div className={styles.now}>
          <span className={styles.dot} />
          いま着手
        </div>
        <article className={styles.card}>
          <div className={styles.project}>
            <span className={styles.box} />
            {cur.project_id != null
              ? (projects.get(cur.project_id) ?? "未分類")
              : "未分類"}
          </div>
          <h1 className={styles.title}>{cur.title}</h1>
          <div className={styles.chips}>
            {chips.map((c) => (
              <span
                key={c.label}
                className={styles.chip}
                data-accent={c.accent ? "" : undefined}
                data-mono={c.mono ? "" : undefined}
              >
                {c.label}
              </span>
            ))}
          </div>
          {cur.memo && <p className={styles.memo}>{cur.memo}</p>}
        </article>

        <section className={styles.after}>
          <div className={styles.afterLabel}>このあと</div>
          {upcoming}
          {rest.length > MAX_UPCOMING && (
            <div className={styles.more}>
              ほか {rest.length - MAX_UPCOMING} 件
            </div>
          )}
          {rest.length === 0 && (
            <div className={styles.last}>これが今日の最後のタスクです</div>
          )}
        </section>

        <div className={styles.nextUp}>
          {rest[0] ? (
            <>
              <span className={styles.afterLabel}>次は</span>
              <span className={styles.nextTitle}>{rest[0].title}</span>
              <span className={styles.est}>{estimate(rest[0])}</span>
            </>
          ) : (
            "これが今日の最後のタスクです"
          )}
        </div>
      </div>

      <aside className={styles.flow} aria-label="今日の流れ">
        <div className={styles.afterLabel}>今日の流れ</div>
        {flow.map((s) => {
          const remain = s.tasks
            .filter((t) => t.status !== "done")
            .reduce((a, t) => a + (t.estimate_minutes ?? 0), 0);
          const on = s.key === slot;
          return (
            <div key={s.key}>
              <div className={styles.flowHeader} data-on={on ? "" : undefined}>
                <span>{s.label}</span>
                <i />
                <span className={styles.mono}>
                  {s.tasks.every((t) => t.status === "done")
                    ? "完了"
                    : `残り ${formatMinutes(remain)}`}
                </span>
              </div>
              {s.tasks.map((t) => {
                const isDone = t.status === "done";
                const isCur = t.id === cur.id;
                return (
                  <div
                    key={t.id}
                    className={styles.flowRow}
                    data-cur={isCur ? "" : undefined}
                    data-done={isDone ? "" : undefined}
                  >
                    <span className={styles.flowMark} />
                    <span className={styles.flowTitle}>{t.title}</span>
                    <span className={styles.est}>{estimate(t)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </aside>
    </div>
  );
}
