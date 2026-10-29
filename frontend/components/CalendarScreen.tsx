"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  WEEK_CELL_LIMIT,
  cellTasks,
  dayCount,
  isMovable,
  rangeKey,
  type CalendarTask,
} from "@/lib/calendar";
import { formatRange, overlappingIds } from "@/lib/fixed";
import { formatEstimate } from "@/lib/inbox";
import { formatDay } from "@/lib/organize";
import { SLOTS, toDateParam, type TimeSlot } from "@/lib/run";
import { useOrganize } from "./OrganizeContext";
import { TaskDetailHost } from "./TaskDetailHost";
import { OrganizeError, OrganizeLoading } from "./OrganizeStates";
import { TASK_ADDED_EVENT } from "./QuickAdd";
import styles from "./CalendarScreen.module.css";

type Load = "loading" | "error" | "ready";
type Target = { day: string; slot: TimeSlot };

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const sameTarget = (a: Target | null, day: string, slot: TimeSlot) =>
  a?.day === day && a.slot === slot;

/** 整理画面の日・週カレンダー。タスクはドラッグで別の日・枠へ移せる(日時が決まる予定は動かさない)。 */
export function CalendarScreen({ mode }: { mode: "day" | "week" }) {
  const { date, setDate, projects, refreshCounts, showToast } = useOrganize();
  const router = useRouter();
  const anchor = toDateParam(date);
  const days = rangeKey(mode, date).split(",");
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Target | null>(null);
  const [selId, setSelId] = useState<number | null>(null);
  const busy = useRef(false);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        const lists = await Promise.all(
          rangeKey(mode, new Date(`${anchor}T00:00`))
            .split(",")
            .map((d) =>
              apiFetch<CalendarTask[]>("/schedule", {
                query: { date: d, include_done: true },
              }),
            ),
        );
        setTasks(lists.flat());
        setLoad("ready");
      } catch {
        if (initial) setLoad("error");
        else showToast({ msg: "更新できませんでした。もう一度お試しください" });
      }
    },
    [mode, anchor, showToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll(true);
  }, [fetchAll]);

  useEffect(() => {
    const onAdded = () => void fetchAll(false);
    window.addEventListener(TASK_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(TASK_ADDED_EVENT, onAdded);
  }, [fetchAll]);

  const projectName = (id: number | null) =>
    projects.find((p) => p.id === id)?.name ?? "";

  const move = async (task: CalendarTask, to: Target) => {
    if (busy.current) return;
    if (task.scheduled_date === to.day && task.time_slot === to.slot) return;
    busy.current = true;
    try {
      await apiFetch(`/tasks/${task.id}/schedule`, {
        method: "PUT",
        body: { scheduled_date: to.day, time_slot: to.slot },
      });
      refreshCounts();
    } catch {
      showToast({ msg: "移動できませんでした。もう一度お試しください" });
    } finally {
      busy.current = false;
      await fetchAll(false);
    }
  };

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return (
      <OrganizeError
        label={mode === "day" ? "カレンダー（日）" : "カレンダー（週）"}
        onRetry={() => void fetchAll(true)}
      />
    );

  const dragged = tasks.find((t) => t.id === dragId);
  const overlaps = overlappingIds(tasks.filter((t) => t.fixed_at));

  const dropProps = (day: string, slot: TimeSlot) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragged) return;
      e.preventDefault();
      setOver((o) => (sameTarget(o, day, slot) ? o : { day, slot }));
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragId(null);
      if (dragged) void move(dragged, { day, slot });
    },
  });

  const selectProps = (t: CalendarTask) => ({
    "data-selected": selId === t.id ? "" : undefined,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelId(t.id);
    },
  });

  const dragProps = (t: CalendarTask) =>
    isMovable(t)
      ? {
          draggable: true as const,
          "data-drag": dragId === t.id ? "" : undefined,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(t.id));
            setDragId(t.id);
          },
          onDragEnd: () => {
            setDragId(null);
            setOver(null);
          },
        }
      : {};

  const estimateOf = (list: CalendarTask[]) =>
    formatEstimate(
      list
        .filter((t) => t.status !== "done")
        .reduce((sum, t) => sum + (t.estimate_minutes ?? 0), 0),
    ) || "0分";

  if (mode === "day") {
    const day = days[0];
    return (
      <>
        <div className={styles.day}>
          {SLOTS.map((s) => {
            const items = cellTasks(tasks, day, s.key);
            return (
              <div key={s.key} className={styles.slot}>
                <div className={styles.slotLabel}>
                  <span className={styles.slotName}>{s.label}</span>
                  <span className={styles.slotCount}>
                    {items.length}件 ·{" "}
                    <span className={styles.mono}>{estimateOf(items)}</span>
                  </span>
                </div>
                <div
                  className={styles.items}
                  data-over={sameTarget(over, day, s.key) ? "" : undefined}
                  {...dropProps(day, s.key)}
                >
                  {items.map((t) => (
                    <div
                      key={t.id}
                      className={styles.item}
                      {...selectProps(t)}
                      {...dragProps(t)}
                    >
                      {t.fixed_at ? (
                        <span
                          className={`${styles.time} ${styles.mono} ${overlaps.has(t.id) ? styles.overlap : ""}`}
                        >
                          {formatRange(t.fixed_at, t.fixed_end_at)}
                        </span>
                      ) : (
                        <span className={styles.mark}>タスク</span>
                      )}
                      <span
                        className={styles.itemTitle}
                        data-done={t.status === "done" ? "" : undefined}
                      >
                        {t.title}
                      </span>
                      <span className={styles.meta}>
                        {[
                          projectName(t.project_id),
                          formatEstimate(t.estimate_minutes),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                  ))}
                  {items.length === 0 && (
                    <div className={styles.emptyRow}>
                      この枠のタスクはありません
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <TaskDetailHost
          taskId={selId}
          onClose={() => {
            setSelId(null);
            void fetchAll(false);
            refreshCounts();
          }}
        />
      </>
    );
  }

  const today = toDateParam(new Date());
  const goDay = (d: string) => {
    setDate(new Date(`${d}T00:00`));
    router.push("/organize/day");
  };

  const head = (d: string) => {
    const x = new Date(`${d}T00:00`);
    const n = dayCount(tasks, d);
    return (
      <button
        key={d}
        className={styles.dayHead}
        data-today={d === today ? "" : undefined}
        onClick={() => goDay(d)}
      >
        <span>
          <span className={styles.mobileOnly}>{x.getMonth() + 1}/</span>
          {x.getDate()} {WD[x.getDay()]}
        </span>
        <span className={styles.dayHeadSub}>{n ? `${n}件` : "—"}</span>
      </button>
    );
  };

  const cell = (d: string, s: { key: TimeSlot; label: string }) => {
    const items = cellTasks(tasks, d, s.key);
    const events = items.filter((t) => t.fixed_at);
    const plain = items.filter((t) => !t.fixed_at);
    return (
      <div
        key={`${d}-${s.key}`}
        className={styles.cell}
        data-over={sameTarget(over, d, s.key) ? "" : undefined}
        title={`${formatDay(new Date(`${d}T00:00`))} ${s.label}`}
        onClick={() => {
          if (window.matchMedia("(max-width: 899px)").matches) goDay(d);
        }}
        {...dropProps(d, s.key)}
      >
        {events.map((t) => (
          <div
            key={t.id}
            className={styles.event}
            data-overlap={overlaps.has(t.id) ? "" : undefined}
            {...selectProps(t)}
          >
            <span className={styles.mono}>
              {formatRange(t.fixed_at as string, t.fixed_end_at)}
            </span>{" "}
            {t.title}
          </div>
        ))}
        {plain.slice(0, WEEK_CELL_LIMIT).map((t) => (
          <div
            key={t.id}
            className={styles.chip}
            data-done={t.status === "done" ? "" : undefined}
            {...selectProps(t)}
            {...dragProps(t)}
          >
            {t.title}
          </div>
        ))}
        {plain.length > WEEK_CELL_LIMIT && (
          <div className={styles.more}>
            他 {plain.length - WEEK_CELL_LIMIT}件
          </div>
        )}
        {items.length > 0 && (
          <div className={styles.summary}>
            <span className={styles.desktopOnly}>
              {items.length}件 · {estimateOf(items)}
            </span>
            <span className={styles.mobileOnly}>{items.length}件</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className={`${styles.week} ${styles.desktopOnly}`}>
        <div />
        {days.map(head)}
        {SLOTS.map((s) => [
          <div key={s.key} className={styles.slotHead}>
            {s.label}
          </div>,
          ...days.map((d) => cell(d, s)),
        ])}
      </div>
      <div className={`${styles.weekMobile} ${styles.mobileOnly}`}>
        <div />
        {SLOTS.map((s) => (
          <div key={s.key} className={styles.slotHead}>
            {s.label}
          </div>
        ))}
        {days.map((d) => [head(d), ...SLOTS.map((s) => cell(d, s))])}
      </div>
      <TaskDetailHost
        taskId={selId}
        onClose={() => {
          setSelId(null);
          void fetchAll(false);
          refreshCounts();
        }}
      />
    </>
  );
}
