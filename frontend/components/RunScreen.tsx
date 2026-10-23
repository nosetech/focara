"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { DEFAULT_DAY_END_HOUR, apiFetch, fetchDayEndHour } from "@/lib/api";
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
  isDayOver,
  moveBody,
  restoreBody,
  somedayBody,
  tomorrowParam,
  spawnsNext,
  toDateParam,
  type RunTask,
  type RunView,
  type TimeSlot,
} from "@/lib/run";
import { TaskDetail } from "./TaskDetail";
import { Toast, type ToastMessage } from "./Toast";
import { EmptyState, ErrorState, LoadingState } from "./StateView";
import styles from "./RunScreen.module.css";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; tasks: RunTask[]; projects: Map<number, string> };

const MAX_UPCOMING = 6;
const TOAST_MS = 4000;
const TAP_SLOP = 8;

function estimate(t: RunTask) {
  return t.estimate_minutes != null ? `${t.estimate_minutes}分` : "";
}

export function RunScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [now, setNow] = useState<Date | null>(null);

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [resumed, setResumed] = useState(false);
  const [dayEndHour, setDayEndHour] = useState(DEFAULT_DAY_END_HOUR);
  const [resched, setResched] = useState(false);
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

  const showToast = useCallback((next: ToastMessage) => {
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

  /** 未完了タスクの予定を変える。date=翌日・別の日の午前中 / null=いつか。 */
  const reschedule = useCallback(
    async (task: RunTask, date: string | null) => {
      setBusy(true);
      try {
        if (date) {
          await apiFetch(`/tasks/${task.id}/postpone`, {
            method: "POST",
            body: moveBody(date),
          });
        } else {
          await apiFetch(`/tasks/${task.id}`, {
            method: "PATCH",
            body: somedayBody(),
          });
        }
        showToast({
          msg: date
            ? `「${task.title}」を${date === tomorrowParam(new Date()) ? "明日" : date}の午前中へ`
            : `「${task.title}」をいつかへ`,
        });
        await fetchAll(true);
      } catch {
        showToast({
          msg: "予定を変えられませんでした。もう一度お試しください",
        });
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
    void fetchDayEndHour().then(setDayEndHour);
    return () => clearTimeout(toastTimer.current);
  }, [fetchAll]);

  const curTask =
    load.state === "ready" ? buildRunView(load.tasks).queue[0] : undefined;

  // デスクトップのショートカット: Enterで完了 / Sで後回し
  useEffect(() => {
    if (!curTask || busy || detailId != null) return;
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
  }, [curTask, busy, detailId, complete, postpone]);

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
      {load.state === "loading" && <LoadingState />}
      {load.state === "error" && (
        <ErrorState
          title="タスクを読み込めませんでした"
          onRetry={() => fetchAll()}
        />
      )}
      {load.state === "ready" && (
        <Ready
          tasks={load.tasks}
          projects={load.projects}
          slot={slot}
          busy={busy}
          onComplete={complete}
          onPostpone={postpone}
          onOpenDetail={setDetailId}
          now={now}
          resumed={resumed}
          dayEndHour={dayEndHour}
          onResume={() => setResumed(true)}
          onResched={() => setResched(true)}
        />
      )}
      {resched && load.state === "ready" && (
        <ReschedSheet
          tasks={buildRunView(load.tasks).queue}
          busy={busy}
          onMove={reschedule}
          onClose={() => setResched(false)}
        />
      )}
      {detailId != null && (
        <TaskDetail
          key={detailId}
          taskId={detailId}
          onClose={() => {
            setDetailId(null);
            void fetchAll(true);
          }}
        />
      )}
      <Toast toast={toast} />
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
  onOpenDetail,
  now,
  resumed,
  dayEndHour,
  onResume,
  onResched,
}: {
  tasks: RunTask[];
  projects: Map<number, string>;
  slot: TimeSlot | null;
  busy: boolean;
  onComplete: (t: RunTask) => Promise<void>;
  onPostpone: (t: RunTask) => Promise<boolean>;
  onOpenDetail: (id: number) => void;
  now: Date | null;
  resumed: boolean;
  dayEndHour: number;
  onResume: () => void;
  onResched: () => void;
}) {
  const view = buildRunView(tasks);
  const cur = view.queue[0];

  if (now && isDayOver(now, view.queue.length, resumed, dayEndHour)) {
    return <DayOver view={view} onResume={onResume} onResched={onResched} />;
  }

  if (view.total === 0) {
    return (
      <EmptyState
        title="今日の予定はありません"
        description="今日やるものを選びましょう。"
        href="/organize"
        actionLabel="inboxを整理する"
      />
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
          onTap={() => onOpenDetail(cur.id)}
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

/** 1日の予定を終えた画面。未完了タスクを「やる」か「予定を変える」かを選ぶ。 */
function DayOver({
  view,
  onResume,
  onResched,
}: {
  view: RunView;
  onResume: () => void;
  onResched: () => void;
}) {
  return (
    <div className={styles.dayOver}>
      <div className={styles.eyebrow}>夜の枠が終わりました</div>
      <h1>今日の予定を終えました</h1>
      <div className={styles.counts}>
        <div>
          <b>{view.done.length}</b>
          <span>完了</span>
        </div>
        <div>
          <b className={styles.dim}>{view.queue.length}</b>
          <span>未完了</span>
        </div>
      </div>
      <div className={styles.leftList}>
        {view.queue.map((t) => (
          <div key={t.id} className={styles.leftRow}>
            <span>{t.title}</span>
            <span className={styles.mono}>{estimate(t)}</span>
          </div>
        ))}
      </div>
      <div className={styles.dayActions}>
        <button className={styles.dayPrimary} onClick={onResume}>
          終わっていないタスクをやる
        </button>
        <button className={styles.dayGhost} onClick={onResched}>
          予定を変える
        </button>
      </div>
    </div>
  );
}

/** 未完了タスクごとに、明日の午前中・別の日・いつかを選ぶボトムシート。 */
function ReschedSheet({
  tasks,
  busy,
  onMove,
  onClose,
}: {
  tasks: RunTask[];
  busy: boolean;
  onMove: (t: RunTask, date: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const tomorrow = tomorrowParam(new Date());
  return (
    <div className={styles.sheetRoot}>
      <div className={styles.sheetBackdrop} onClick={onClose} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="予定を変える"
      >
        <div className={styles.grabber} />
        <h2>予定を変える</h2>
        <p>終わっていないタスクの行き先を決めます。</p>
        <div className={styles.reschedList}>
          {tasks.length === 0 && (
            <div className={styles.leftRow}>未完了のタスクはありません</div>
          )}
          {tasks.map((t) => (
            <div key={t.id} className={styles.reschedRow}>
              <span className={styles.reschedTitle}>{t.title}</span>
              <button disabled={busy} onClick={() => void onMove(t, tomorrow)}>
                明日の午前中
              </button>
              <input
                type="date"
                aria-label={`${t.title}の日付を選ぶ`}
                min={tomorrow}
                disabled={busy}
                onChange={(e) =>
                  e.target.value && void onMove(t, e.target.value)
                }
              />
              <button disabled={busy} onClick={() => void onMove(t, null)}>
                いつか
              </button>
            </div>
          ))}
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

/** 左スワイプで後回し。タッチ・マウス・ペンはPointer Eventsで共通に扱う。 */
function SwipeCard({
  children,
  disabled,
  onSwiped,
  onTap,
}: {
  children: ReactNode;
  disabled: boolean;
  onSwiped: () => Promise<boolean>;
  onTap: () => void;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const moved = useRef(false);

  const onDown = (e: PointerEvent<HTMLElement>) => {
    if (disabled || e.button > 0) return;
    startX.current = e.clientX;
    moved.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (startX.current == null) return;
    const d = e.clientX - startX.current;
    if (Math.abs(d) > TAP_SLOP) moved.current = true;
    setDx(dragOffset(d));
  };
  const onUp = async () => {
    if (startX.current == null) return;
    startX.current = null;
    setDragging(false);
    if (dx > -SWIPE_THRESHOLD) {
      setDx(0);
      if (!moved.current) onTap();
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
        onPointerCancel={() => {
          moved.current = true;
          void onUp();
        }}
      >
        {children}
      </article>
    </div>
  );
}
