"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  SLOTS,
  SWIPE_THRESHOLD,
  SLOT_LABEL,
  buildRunView,
  currentSlot,
  dragOffset,
  formatClock,
  formatDateLabel,
  formatMinutes,
  restoreBody,
  spawnsNext,
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
const TOAST_MS = 4000;

interface Toast {
  msg: string;
  undo?: () => void;
}

function estimate(t: RunTask) {
  return t.estimate_minutes != null ? `${t.estimate_minutes}分` : "";
}

export function RunScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [now, setNow] = useState<Date | null>(null);

  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoad({ state: "loading" });
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

  const showToast = useCallback((next: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const complete = useCallback(
    async (task: RunTask) => {
      setBusy(true);
      try {
        await apiFetch(`/tasks/${task.id}/complete`, { method: "POST" });
        showToast({
          msg: spawnsNext(task)
            ? "完了しました · 次の回を生成しました"
            : "完了しました · 今日の記録に追加",
        });
        await fetchAll(true);
      } catch {
        showToast({ msg: "完了できませんでした。もう一度お試しください" });
      } finally {
        setBusy(false);
      }
    },
    [fetchAll, showToast],
  );

  /** 戻り値は成功したか(失敗時は呼び出し側でカードを元の位置に戻す)。 */
  const postpone = useCallback(
    async (task: RunTask): Promise<boolean> => {
      setBusy(true);
      try {
        await apiFetch(`/tasks/${task.id}/postpone`, {
          method: "POST",
          body: { target: "end_of_day" },
        });
        showToast({
          msg: `「${task.title}」を後回しにしました`,
          undo: async () => {
            clearTimeout(toastTimer.current);
            setToast(null);
            try {
              await apiFetch(`/tasks/${task.id}`, {
                method: "PATCH",
                body: restoreBody(task),
              });
              await fetchAll(true);
            } catch {
              showToast({ msg: "元に戻せませんでした" });
            }
          },
        });
        await fetchAll(true);
        return true;
      } catch {
        showToast({ msg: "後回しにできませんでした。もう一度お試しください" });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [fetchAll, showToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
    void fetchAll();
    return () => clearTimeout(toastTimer.current);
  }, [fetchAll]);

  const curTask =
    load.state === "ready" ? buildRunView(load.tasks).queue[0] : undefined;

  // デスクトップのショートカット: Enterで完了 / Sで後回し
  useEffect(() => {
    if (!curTask || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Enter") {
        e.preventDefault();
        void complete(curTask);
      } else if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        void postpone(curTask);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [curTask, busy, complete, postpone]);

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
      {load.state === "error" && <ErrorView onRetry={() => fetchAll()} />}
      {load.state === "ready" && (
        <Ready
          tasks={load.tasks}
          projects={load.projects}
          slot={slot}
          busy={busy}
          onComplete={complete}
          onPostpone={postpone}
        />
      )}
      <div
        className={styles.toast}
        data-show={toast ? "" : undefined}
        role="status"
        aria-live="polite"
      >
        <span>{toast?.msg}</span>
        {toast?.undo && (
          <button onClick={toast.undo} className={styles.toastUndo}>
            元に戻す
          </button>
        )}
      </div>
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
  busy,
  onComplete,
  onPostpone,
}: {
  tasks: RunTask[];
  projects: Map<number, string>;
  slot: TimeSlot | null;
  busy: boolean;
  onComplete: (t: RunTask) => Promise<void>;
  onPostpone: (t: RunTask) => Promise<boolean>;
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
        <SwipeCard
          key={cur.id}
          disabled={busy}
          onSwiped={() => onPostpone(cur)}
        >
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
        </SwipeCard>

        <div className={styles.actions}>
          <button
            className={styles.complete}
            disabled={busy}
            onClick={() => void onComplete(cur)}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {busy ? "処理中" : "完了"}
            <kbd>Enter</kbd>
          </button>
          <button
            className={styles.postpone}
            disabled={busy}
            onClick={() => void onPostpone(cur)}
          >
            後回し
            <kbd>S</kbd>
          </button>
        </div>

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

/** 左スワイプで後回し。タッチ・マウス・ペンはPointer Eventsで共通に扱う。 */
function SwipeCard({
  children,
  disabled,
  onSwiped,
}: {
  children: ReactNode;
  disabled: boolean;
  onSwiped: () => Promise<boolean>;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button > 0) return;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (startX.current == null) return;
    setDx(dragOffset(e.clientX - startX.current));
  };
  const onUp = async () => {
    if (startX.current == null) return;
    startX.current = null;
    setDragging(false);
    if (dx > -SWIPE_THRESHOLD) {
      setDx(0);
      return;
    }
    setDx(-420);
    // 成功すると次のタスクに差し替わりこのカードごと消える。失敗時だけ戻す
    if (!(await onSwiped())) setDx(0);
  };

  const armed = dx < -SWIPE_THRESHOLD;
  return (
    <div className={styles.swipe}>
      <div
        className={styles.reveal}
        data-armed={armed ? "" : undefined}
        style={{ opacity: Math.min(1, Math.max(0, -dx / 60)) }}
        aria-hidden="true"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M4 12h14M13 6l6 6-6 6" />
        </svg>
        後回し
      </div>
      <article
        className={styles.card}
        data-dragging={dragging ? "" : undefined}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={() => void onUp()}
        onPointerCancel={() => void onUp()}
      >
        {children}
      </article>
    </div>
  );
}
