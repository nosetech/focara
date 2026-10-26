"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  COLUMNS,
  insertAt,
  isCandidate,
  slotTasks,
  totalEstimate,
  type AssignTask,
  type Column,
} from "@/lib/assign";
import { formatEstimate } from "@/lib/inbox";
import { toDateParam, type TimeSlot } from "@/lib/run";
import { useOrganize } from "./OrganizeContext";
import { OrganizeError, OrganizeLoading } from "./OrganizeStates";
import { TASK_ADDED_EVENT } from "./QuickAdd";
import styles from "./AssignScreen.module.css";

type Load = "loading" | "error" | "ready";

/** 整理画面の3枠割り当て。候補を午前中・午後・夜へドラッグ(またはボタン)で割り当て、枠内で並べ替える。 */
export function AssignScreen() {
  const { date, projects, refreshCounts, showToast } = useOrganize();
  const day = toDateParam(date);
  const [candidates, setCandidates] = useState<AssignTask[]>([]);
  const [scheduled, setScheduled] = useState<AssignTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ col: Column; index?: number } | null>(
    null,
  );
  const busy = useRef(false);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        const [next, onDay] = await Promise.all([
          apiFetch<AssignTask[]>("/tasks", { query: { status: "next" } }),
          apiFetch<AssignTask[]>("/schedule", {
            query: { date: day, include_done: true },
          }),
        ]);
        setCandidates(next.filter(isCandidate));
        setScheduled(onDay);
        setLoad("ready");
      } catch {
        if (initial) setLoad("error");
        else showToast({ msg: "更新できませんでした。もう一度お試しください" });
      }
    },
    [day, showToast],
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

  const move = useCallback(
    async (task: AssignTask, target: Column, index?: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        if (target === "none") {
          if (isCandidate(task)) return;
          await apiFetch(`/tasks/${task.id}/schedule`, { method: "DELETE" });
        } else {
          const here = slotTasks(scheduled, target).map((t) => t.id);
          const inSlot =
            task.scheduled_date === day && task.time_slot === target;
          if (!inSlot) {
            await apiFetch(`/tasks/${task.id}/schedule`, {
              method: "PUT",
              body: { scheduled_date: day, time_slot: target },
            });
            here.push(task.id);
          }
          await apiFetch("/schedule/order", {
            method: "PUT",
            body: {
              scheduled_date: day,
              time_slot: target,
              task_ids: insertAt(here, task.id, index),
            },
          });
        }
        refreshCounts();
      } catch {
        showToast({ msg: "割り当てできませんでした。もう一度お試しください" });
      } finally {
        busy.current = false;
        await fetchAll(false);
      }
    },
    [day, scheduled, fetchAll, refreshCounts, showToast],
  );

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return (
      <OrganizeError label="3枠割り当て" onRetry={() => void fetchAll(true)} />
    );

  const all = [...candidates, ...scheduled];
  const dragged = all.find((t) => t.id === dragId);
  const columns = COLUMNS.map((c) => ({
    ...c,
    tasks:
      c.key === "none" ? candidates : slotTasks(scheduled, c.key as TimeSlot),
  }));

  const drop = (col: Column, index?: number) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    setDragId(null);
    if (dragged) void move(dragged, col, index);
  };

  return (
    <div className={styles.grid}>
      {columns.map((c) => (
        <div
          key={c.key}
          className={styles.col}
          data-none={c.key === "none" ? "" : undefined}
          data-dragging={dragId !== null ? "" : undefined}
          data-over={over?.col === c.key ? "" : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver((o) => (o?.col === c.key ? o : { col: c.key }));
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setOver(null);
          }}
          onDrop={drop(c.key)}
        >
          <div className={styles.head}>
            <span className={styles.name}>{c.label}</span>
            <span className={styles.count}>
              {c.tasks.length}件 · 合計{" "}
              <span className={styles.mono}>
                {formatEstimate(
                  totalEstimate(c.tasks.filter((t) => t.status !== "done")),
                ) || "0分"}
              </span>
            </span>
          </div>
          {c.tasks.map((t, i) => (
            <div
              key={t.id}
              className={styles.card}
              draggable
              data-drag={dragId === t.id ? "" : undefined}
              data-drop={
                over?.col === c.key && over.index === i && dragId !== t.id
                  ? ""
                  : undefined
              }
              style={
                t.status === "done"
                  ? { textDecoration: "line-through", opacity: 0.5 }
                  : undefined
              }
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(t.id));
                setDragId(t.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (c.key === "none") return;
                e.preventDefault();
                e.stopPropagation();
                setOver({ col: c.key, index: i });
              }}
              onDrop={c.key === "none" ? undefined : drop(c.key, i)}
            >
              <div className={styles.title}>{t.title}</div>
              <div className={styles.meta}>
                <span>{projectName(t.project_id) || "プロジェクトなし"}</span>
                <span className={styles.mono}>
                  {formatEstimate(t.estimate_minutes)}
                </span>
              </div>
              {c.key === "none" && (
                <div className={styles.slotBtns}>
                  {COLUMNS.filter((x) => x.key !== "none").map((s) => (
                    <button
                      key={s.key}
                      className={styles.slotBtn}
                      onClick={() => void move(t, s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {c.tasks.length === 0 && (
            <div className={styles.empty}>
              {c.key === "none"
                ? "未割り当てのタスクはありません"
                : "ここにドラッグして割り当て"}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
