"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  DEFAULT_FILTERS,
  filterInbox,
  formatEstimate,
  priorityLabel,
} from "@/lib/inbox";
import {
  groupByStatus,
  movedOrder,
  projectProgress,
  type ProjectSummary,
  type ProjectTask,
} from "@/lib/projects";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import { TASK_ADDED_EVENT } from "./QuickAdd";
import { TaskDetail } from "./TaskDetail";
import styles from "./ProjectsScreen.module.css";

type Load = "loading" | "error" | "ready";
type Form = { mode: "create" | "edit"; name: string; description: string };

const PREFIX = "プロジェクト";

/** 整理画面のプロジェクト。一覧(進捗・件数)と、選んだプロジェクトの所属タスクの管理・並べ替え。 */
export function ProjectsScreen() {
  const { filters, clearFilters, refreshProjects, refreshCounts, showToast } =
    useOrganize();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [selId, setSelId] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const busy = useRef(false);

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        const [ps, ts] = await Promise.all([
          apiFetch<ProjectSummary[]>("/projects"),
          apiFetch<ProjectTask[]>("/tasks"),
        ]);
        setProjects(ps);
        setTasks(ts);
        setLoad("ready");
      } catch {
        if (initial) setLoad("error");
        else showToast({ msg: "更新できませんでした。もう一度お試しください" });
      }
    },
    [showToast],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll(true);
    const onAdded = () => void fetchAll(false);
    window.addEventListener(TASK_ADDED_EVENT, onAdded);
    return () => window.removeEventListener(TASK_ADDED_EVENT, onAdded);
  }, [fetchAll]);

  const selected = projects.find((p) => p.id === selId) ?? null;
  const owned = useMemo(
    () => tasks.filter((t) => t.project_id === selected?.id),
    [tasks, selected],
  );
  const shown = useMemo(
    () => filterInbox(owned, { ...filters, project: "" }, () => ""),
    [owned, filters],
  );
  const filtered =
    filters.status !== "" ||
    filters.pri !== "" ||
    filters.sort !== DEFAULT_FILTERS.sort;
  const candidates = tasks.filter(
    (t) => t.project_id !== selected?.id && t.status !== "done",
  );

  const run = async (
    action: () => Promise<unknown>,
    failMsg: string,
    okMsg?: string,
  ) => {
    if (busy.current) return false;
    busy.current = true;
    try {
      await action();
      if (okMsg) showToast({ msg: okMsg });
      return true;
    } catch {
      showToast({ msg: failMsg });
      return false;
    } finally {
      busy.current = false;
      await fetchAll(false);
      refreshProjects();
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
    };
    if (form.mode === "create") {
      let created: ProjectSummary | null = null;
      const ok = await run(
        async () => {
          created = await apiFetch<ProjectSummary>("/projects", {
            method: "POST",
            body,
          });
        },
        "作成できませんでした。もう一度お試しください",
        `${PREFIX}「${body.name}」を作成しました`,
      );
      if (ok && created) setSelId((created as ProjectSummary).id);
      if (ok) setForm(null);
    } else if (selected) {
      const ok = await run(
        () => apiFetch(`/projects/${selected.id}`, { method: "PATCH", body }),
        "保存できませんでした。もう一度お試しください",
      );
      if (ok) setForm(null);
    }
  };

  const remove = async () => {
    if (!selected) return;
    const name = selected.name;
    const ok = await run(
      () => apiFetch(`/projects/${selected.id}`, { method: "DELETE" }),
      "削除できませんでした。もう一度お試しください",
      `${PREFIX}「${name}」を削除しました(タスクは残ります)`,
    );
    setConfirmDelete(false);
    if (ok) {
      setSelId(null);
      refreshCounts();
    }
  };

  const setMembership = (task: ProjectTask, projectId: number | null) =>
    run(
      () =>
        apiFetch(`/tasks/${task.id}`, {
          method: "PATCH",
          body: { project_id: projectId },
        }),
      "更新できませんでした。もう一度お試しください",
    );

  const move = (task: ProjectTask, delta: -1 | 1) => {
    const ids = selected && movedOrder(owned, task.id, delta);
    if (!selected || !ids) return;
    void run(
      () =>
        apiFetch(`/projects/${selected.id}/task-order`, {
          method: "PUT",
          body: { task_ids: ids },
        }),
      "並べ替えられませんでした。もう一度お試しください",
    );
  };

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return <OrganizeError label={PREFIX} onRetry={() => void fetchAll(true)} />;

  const progress = projectProgress(owned);
  const groups = groupByStatus(shown);

  const formEl = form && (
    <form className={styles.form} onSubmit={(e) => void submitForm(e)}>
      <label className={styles.fieldLabel} htmlFor="project-name">
        {PREFIX}名
      </label>
      <input
        id="project-name"
        className={styles.input}
        autoFocus
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <label className={styles.fieldLabel} htmlFor="project-description">
        説明(任意)
      </label>
      <textarea
        id="project-description"
        className={styles.textarea}
        rows={2}
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
      />
      <div className={styles.formActions}>
        <button
          className={styles.primary}
          type="submit"
          disabled={!form.name.trim()}
        >
          {form.mode === "create" ? "作成" : "保存"}
        </button>
        <button
          className={styles.link}
          type="button"
          onClick={() => setForm(null)}
        >
          キャンセル
        </button>
      </div>
    </form>
  );

  const taskRow = (t: ProjectTask, g: { tasks: ProjectTask[] }, i: number) => (
    <li key={t.id} className={styles.row}>
      <button className={styles.rowBody} onClick={() => setDetailId(t.id)}>
        <span
          className={styles.title}
          data-done={t.status === "done" ? "" : undefined}
        >
          {t.title}
        </span>
        <span className={styles.meta}>
          {t.scheduled_date && <span>{t.scheduled_date.slice(5)}</span>}
          {t.priority && <span>優先度 {priorityLabel(t.priority)}</span>}
          {t.estimate_minutes ? (
            <span className={styles.mono}>
              {formatEstimate(t.estimate_minutes)}
            </span>
          ) : null}
        </span>
      </button>
      <div className={styles.rowActions}>
        <button
          className={styles.iconButton}
          aria-label="上へ"
          disabled={filtered || i === 0}
          onClick={() => move(t, -1)}
        >
          ↑
        </button>
        <button
          className={styles.iconButton}
          aria-label="下へ"
          disabled={filtered || i === g.tasks.length - 1}
          onClick={() => move(t, 1)}
        >
          ↓
        </button>
        <button
          className={styles.action}
          onClick={() => void setMembership(t, null)}
        >
          外す
        </button>
      </div>
    </li>
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
      {confirmDelete && selected && (
        <div
          className={styles.backdrop}
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="project-delete-title" className={styles.dialogTitle}>
              「{selected.name}」を削除しますか?
            </div>
            <div className={styles.dialogText}>
              {PREFIX}だけが削除されます。所属していたタスク({owned.length}
              件)は残り、{PREFIX}なしになります。
            </div>
            <div className={styles.formActions}>
              <button
                className={styles.danger}
                onClick={() => void remove()}
                autoFocus
              >
                削除する
              </button>
              <button
                className={styles.link}
                onClick={() => setConfirmDelete(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.grid} data-selected={selected ? "" : undefined}>
        <div className={styles.projects}>
          {projects.map((p) => {
            const pr = projectProgress(
              tasks.filter((t) => t.project_id === p.id),
            );
            return (
              <button
                key={p.id}
                className={styles.project}
                data-on={selected?.id === p.id ? "" : undefined}
                onClick={() => {
                  setSelId(p.id);
                  setForm(null);
                }}
              >
                <span className={styles.projectTop}>
                  <span className={styles.projectName}>{p.name}</span>
                  <span className={styles.mono}>
                    {pr.done}/{pr.total}
                  </span>
                </span>
                <span className={styles.bar}>
                  <i style={{ width: `${pr.pct}%` }} />
                </span>
              </button>
            );
          })}
          {form?.mode === "create" ? (
            formEl
          ) : (
            <button
              className={styles.outline}
              onClick={() => {
                setForm({ mode: "create", name: "", description: "" });
              }}
            >
              ＋ 新しい{PREFIX}
            </button>
          )}
        </div>

        <div className={styles.detail}>
          {projects.length === 0 ? (
            <OrganizeEmpty
              title={`${PREFIX}はまだありません`}
              text="関連するタスクをまとめると、進み具合が見えるようになります。"
            />
          ) : !selected ? (
            <div className={styles.hint}>{PREFIX}を選んでください</div>
          ) : (
            <>
              <div className={styles.header}>
                <button
                  className={styles.back}
                  onClick={() => {
                    setSelId(null);
                    setForm(null);
                  }}
                >
                  ‹ {PREFIX}一覧
                </button>
                <div className={styles.headerTop}>
                  <span className={styles.headerName}>{selected.name}</span>
                  <span className={styles.headerProgress}>
                    進捗{" "}
                    <span className={styles.mono}>
                      {progress.done}/{progress.total}
                    </span>
                  </span>
                </div>
                {selected.description && (
                  <div className={styles.description}>
                    {selected.description}
                  </div>
                )}
                <div className={styles.bar} data-large="">
                  <i style={{ width: `${progress.pct}%` }} />
                </div>
                {form?.mode === "edit" ? (
                  formEl
                ) : (
                  <div className={styles.headerActions}>
                    <button
                      className={styles.action}
                      onClick={() =>
                        setForm({
                          mode: "edit",
                          name: selected.name,
                          description: selected.description ?? "",
                        })
                      }
                    >
                      編集
                    </button>
                    <button
                      className={styles.action}
                      onClick={() => setConfirmDelete(true)}
                    >
                      削除
                    </button>
                    <select
                      className={styles.select}
                      value=""
                      aria-label="タスクを追加"
                      disabled={candidates.length === 0}
                      onChange={(e) => {
                        const task = candidates.find(
                          (t) => t.id === Number(e.target.value),
                        );
                        if (task) void setMembership(task, selected.id);
                      }}
                    >
                      <option value="">タスクを追加</option>
                      {candidates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {groups.length === 0 ? (
                owned.length === 0 ? (
                  <OrganizeEmpty
                    title={`この${PREFIX}にタスクはありません`}
                    text={`上の「タスクを追加」か、タスク詳細の「${PREFIX}」から、ここにまとめられます。`}
                  />
                ) : (
                  <div className={styles.emptyFiltered}>
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
                groups.map((g) => (
                  <section key={g.status}>
                    <div className={styles.groupLabel}>
                      {g.label}
                      <span className={styles.mono}>{g.tasks.length}</span>
                    </div>
                    <ul className={styles.list}>
                      {g.tasks.map((t, i) => taskRow(t, g, i))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
