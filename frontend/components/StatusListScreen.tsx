"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { filterInbox, formatEstimate, priorityLabel } from "@/lib/inbox";
import {
  LIST_COPY,
  formatWaitUntil,
  type ListStatus,
  type ListTask,
} from "@/lib/statusList";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import { TaskDetailHost } from "./TaskDetailHost";
import styles from "./InboxScreen.module.css";
import extra from "./StatusListScreen.module.css";

type Load = "loading" | "error" | "ready";

/** 整理画面の条件待ち・いつか。一覧と、待ち条件の編集、次にやるへの復帰。 */
export function StatusListScreen({ status }: { status: ListStatus }) {
  const { filters, clearFilters, projects, refreshCounts, showToast } =
    useOrganize();
  const copy = LIST_COPY[status];
  const [tasks, setTasks] = useState<ListTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [selId, setSelId] = useState<number | null>(null);
  const busy = useRef(false);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        const list = await apiFetch<ListTask[]>("/tasks", {
          query: { status },
        });
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

  return (
    <>
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
                  </div>
                  {status === "waiting" && (
                    <div className={extra.note}>
                      条件: {t.wait_condition || "未設定"}
                      {t.wait_until && ` · ${formatWaitUntil(t.wait_until)}`}
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

      <TaskDetailHost
        taskId={current?.id ?? null}
        showEmpty
        onClose={() => {
          setSelId(null);
          void fetchAll(false);
          refreshCounts();
        }}
      />
    </>
  );
}
