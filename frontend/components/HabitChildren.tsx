"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  CHILD_FILTERS,
  CHILD_KIND_LABEL,
  CHILD_PREVIEW,
  childDateLabel,
  childKind,
  filterChildren,
  sortChildren,
  visibleChildren,
  type ChildFilter,
  type HabitChild,
} from "@/lib/habits";
import { toDateParam } from "@/lib/run";
import own from "./HabitSheet.module.css";

/**
 * 習慣シートの「子タスク」。その習慣のすべての子を予定日の新しい順に並べ、
 * 「キャンセル」で絞り込める。行を押すと子の詳細を開く(キャンセルは詳細から取り消す)。
 * 子が0件の習慣では何も出さない。終了済みの習慣でも閲覧できる。
 */
export function HabitChildren({
  habitId,
  reloadKey,
  onOpen,
}: {
  habitId: number;
  /** 変えると取り直す(詳細で状態を変えたあと) */
  reloadKey: number;
  onOpen: (taskId: number) => void;
}) {
  const [children, setChildren] = useState<HabitChild[]>([]);
  const [filter, setFilter] = useState<ChildFilter>("all");
  const [expanded, setExpanded] = useState(false);
  const [today] = useState(() => toDateParam(new Date()));

  useEffect(() => {
    let alive = true;
    apiFetch<HabitChild[]>("/tasks", { query: { habit_id: habitId } })
      .then((rows) => alive && setChildren(sortChildren(rows)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [habitId, reloadKey]);

  if (children.length === 0) return null;

  const cancelledCount = filterChildren(children, "cancelled").length;
  const counts: Record<ChildFilter, number> = {
    all: children.length,
    cancelled: cancelledCount,
  };
  const list = filterChildren(children, filter);
  const shown = visibleChildren(list, expanded);

  return (
    <section className={own.children} aria-labelledby="hs-children-h">
      <div className={own.childrenHead}>
        <div className={own.childrenTitle}>
          <span id="hs-children-h">子タスク</span>
          <span>
            <span className={own.mono}>{children.length}</span>件
          </span>
        </div>
        <div
          className={own.childFilters}
          role="group"
          aria-label="子タスクの絞り込み"
        >
          {CHILD_FILTERS.map((f) => (
            <button
              key={f.key}
              aria-pressed={filter === f.key}
              data-on={filter === f.key ? "" : undefined}
              onClick={() => {
                setFilter(f.key);
                setExpanded(false);
              }}
            >
              {filter === f.key && (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
              {f.label}
              <span className={own.mono}>{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={own.childList}>
        {shown.map((c) => {
          const kind = childKind(c.status);
          const label = childDateLabel(c.occurrence_date);
          return (
            <button
              key={c.id}
              className={own.childRow}
              data-kind={kind}
              aria-label={`${label}の子タスク(${CHILD_KIND_LABEL[kind]})を開く`}
              onClick={() => onOpen(c.id)}
            >
              <span className={own.childDate}>
                {label}
                {c.occurrence_date === today && (
                  <span className={own.childToday}>今日</span>
                )}
              </span>
              <span className={own.childBadge} data-kind={kind}>
                {kind === "done" && (
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
                {CHILD_KIND_LABEL[kind]}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={own.childChevron}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          );
        })}
        {list.length === 0 && (
          <div className={own.childEmpty}>
            キャンセルした子タスクはありません
          </div>
        )}
      </div>
      {list.length > CHILD_PREVIEW && (
        <button
          className={own.childMore}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? "折りたたむ"
            : `もっと見る(残り ${list.length - CHILD_PREVIEW}件)`}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </section>
  );
}
