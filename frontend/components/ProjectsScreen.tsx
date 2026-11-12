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
  addTags,
  byProjectOrder,
  collectTags,
  filterByTags,
  groupByStatus,
  isProjectDone,
  movedOrder,
  openTaskCount,
  projectProgress,
  type ProjectSummary,
  type ProjectTask,
  visibleProjects,
} from "@/lib/projects";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import { TASK_ADDED_EVENT } from "./QuickAdd";
import { TagChips } from "./TagChips";
import { TagInput } from "./TagInput";
import { TaskDetailHost } from "./TaskDetailHost";
import styles from "./ProjectsScreen.module.css";

type Load = "loading" | "error" | "ready";
type Form = {
  mode: "create" | "edit";
  name: string;
  /** 画面では編集しない(デザインに欄がない)。編集時に既存の値を保つために持つ */
  description: string;
  tags: string[];
  /** タグ欄に入力中で、まだ確定していない文字 */
  tagDraft: string;
};

const PREFIX = "プロジェクト";

/** 整理画面のプロジェクト。一覧(進捗・件数)と、選んだプロジェクトの所属タスクの管理・並べ替え。 */
export function ProjectsScreen() {
  const {
    filters,
    clearFilters,
    refreshProjects,
    refreshCounts,
    showToast,
    showCompleted,
  } = useOrganize();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [selId, setSelId] = useState<number | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
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

  const listed = useMemo(
    () => visibleProjects(projects, showCompleted),
    [projects, showCompleted],
  );
  // 絞り込み中のタグは、一覧から該当するプロジェクトが消えても(完了済みを隠したときなど)
  // チップに残す(件数0)。選び直すか解除するまで絞り込みを保ち、「該当なし」を出す(デザインどおり)
  const allTags = useMemo(() => {
    const base = collectTags(listed);
    return [...base, ...tagFilter.filter((t) => !base.includes(t))];
  }, [listed, tagFilter]);
  const activeTags = tagFilter;
  const listedByTag = useMemo(
    () => filterByTags(listed, activeTags),
    [listed, activeTags],
  );
  const selected = listed.find((p) => p.id === selId) ?? null;
  const owned = useMemo(
    () => tasks.filter((t) => t.project_id === selected?.id),
    [tasks, selected],
  );
  const shown = useMemo(
    () =>
      filterInbox(byProjectOrder(owned), { ...filters, project: "" }, () => ""),
    [owned, filters],
  );
  const filtered =
    filters.status !== "" ||
    filters.pri !== "" ||
    filters.sort !== DEFAULT_FILTERS.sort;
  const completed = selected ? isProjectDone(selected) : false;
  const candidates = tasks.filter(
    (t) =>
      !completed &&
      t.project_id !== selected?.id &&
      t.status !== "done" &&
      t.status !== "cancelled",
  );

  const run = async (
    action: () => Promise<unknown>,
    failMsg: string,
    okMsg?: string,
  ) => {
    if (busy.current) return false;
    busy.current = true;
    let ok = true;
    try {
      await action();
      if (okMsg) showToast({ msg: okMsg });
    } catch {
      showToast({ msg: failMsg });
      ok = false;
    }
    busy.current = false;
    void fetchAll(false);
    refreshProjects();
    return ok;
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form || !form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      // 入力中のタグも、保存時に取り込む
      tags: addTags(form.tags, [form.tagDraft]).tags,
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

  const reopen = async (p: ProjectSummary, restoreIds: number[] = []) => {
    const ok = await run(async () => {
      await apiFetch(`/projects/${p.id}`, {
        method: "PATCH",
        body: { completed: false },
      });
      for (const id of restoreIds)
        await apiFetch(`/tasks/${id}/transition`, {
          method: "POST",
          body: { status: "next" },
        });
    }, "未完了に戻せませんでした。もう一度お試しください");
    if (ok) refreshCounts();
    return ok;
  };

  /** 完了にする。未完了タスクがあれば withTasks が true のときだけ一括で完了にする。 */
  const complete = async (p: ProjectSummary, withTasks: boolean) => {
    const targets = withTasks
      ? tasks
          .filter(
            (t) =>
              t.project_id === p.id &&
              t.status !== "done" &&
              t.status !== "cancelled",
          )
          .map((t) => t.id)
      : [];
    const ok = await run(
      () =>
        apiFetch(`/projects/${p.id}`, {
          method: "PATCH",
          body: { completed: true, complete_tasks: withTasks },
        }),
      "完了にできませんでした。もう一度お試しください",
    );
    setConfirmComplete(false);
    if (!ok) return;
    refreshCounts();
    // 完了済みを表示しない設定なら、一覧から消えるので選択を外す
    if (!showCompleted) setSelId(null);
    showToast({
      msg: `${PREFIX}「${p.name}」を完了にしました`,
      undo: () => void reopen(p, targets),
    });
  };

  const requestComplete = async (p: ProjectSummary) => {
    if (openTaskCount(tasks.filter((t) => t.project_id === p.id)) > 0) {
      setConfirmComplete(true);
      return;
    }
    await complete(p, false);
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

  const noMatchEmpty = (
    <OrganizeEmpty
      title={`該当する${PREFIX}はありません`}
      text={`${activeTags.map((t) => `「${t}」`).join("")}のいずれかを含む${PREFIX}がありません。タグを選び直すか、絞り込みを解除してください。`}
      action={{
        label: "絞り込みを解除",
        onClick: () => setTagFilter([]),
      }}
    />
  );
  const groups = groupByStatus(shown);

  // 作成・編集フォーム。デスクトップは中央寄りのモーダル、モバイルは下からのシート(デザインどおり)
  const formDialog = form && (
    <>
      <div className={styles.formBackdrop} onClick={() => setForm(null)} />
      <form
        className={styles.formDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-form-title"
        onSubmit={(e) => void submitForm(e)}
      >
        <div id="project-form-title" className={styles.formTitle}>
          {form.mode === "edit" ? `${PREFIX}を編集` : `新しい${PREFIX}`}
        </div>
        <div className={styles.formField}>
          <label className={styles.formLabel} htmlFor="project-name">
            {PREFIX}名
          </label>
          <input
            id="project-name"
            className={styles.formInput}
            autoFocus
            autoComplete="off"
            placeholder="例: 新サービス企画"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                setForm(null);
              }
            }}
          />
        </div>
        <TagInput
          tags={form.tags}
          draft={form.tagDraft}
          suggestions={collectTags(projects)}
          // タグと入力中の文字を続けて更新するので、直前の状態から作る(古い form で上書きしない)
          onChange={(tags) => setForm((f) => f && { ...f, tags })}
          onDraftChange={(tagDraft) => setForm((f) => f && { ...f, tagDraft })}
          onEscape={() => setForm(null)}
        />
        <div className={styles.formButtons}>
          <button
            className={styles.formCancel}
            type="button"
            onClick={() => setForm(null)}
          >
            キャンセル
          </button>
          <button
            className={styles.formSave}
            type="submit"
            disabled={!form.name.trim()}
          >
            {form.mode === "create" ? "作成" : "保存"}
          </button>
        </div>
      </form>
    </>
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
      <TaskDetailHost
        taskId={detailId}
        showEmpty
        onClose={() => {
          setDetailId(null);
          void fetchAll(false);
          refreshCounts();
        }}
      />
      {formDialog}
      {confirmComplete && selected && (
        <div
          className={styles.backdrop}
          onClick={() => setConfirmComplete(false)}
        >
          <div
            className={styles.dialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="project-complete-title"
            aria-describedby="project-complete-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="project-complete-title" className={styles.dialogTitle}>
              「{selected.name}」を完了にしますか?
            </div>
            <div id="project-complete-desc" className={styles.dialogText}>
              未完了のタスクが{" "}
              <span className={styles.mono}>{openTaskCount(owned)}</span>{" "}
              件あります。すべて完了にして{PREFIX}を完了にしますか?
            </div>
            <div className={styles.formActions}>
              <button
                className={styles.link}
                onClick={() => setConfirmComplete(false)}
              >
                いいえ
              </button>
              <button
                className={styles.primary}
                onClick={() => void complete(selected, true)}
                autoFocus
              >
                はい
              </button>
            </div>
          </div>
        </div>
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

      {allTags.length > 0 && (
        <div
          className={styles.tagFilter}
          role="group"
          aria-label="タグで絞り込む"
        >
          <span className={styles.tagFilterLabel}>タグ</span>
          {allTags.map((t) => {
            const on = activeTags.includes(t);
            return (
              <button
                key={t}
                className={styles.tagFilterChip}
                aria-pressed={on}
                data-on={on ? "" : undefined}
                onClick={() =>
                  setTagFilter(
                    on ? activeTags.filter((x) => x !== t) : [...activeTags, t],
                  )
                }
              >
                {on && (
                  <svg
                    aria-hidden="true"
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
                {t}
                <span className={styles.tagCount}>
                  {listed.filter((p) => p.tags.includes(t)).length}
                </span>
              </button>
            );
          })}
          {activeTags.length > 0 && (
            <>
              <span className={styles.tagFilterNote}>
                いずれかを含む · {listedByTag.length}件
              </span>
              <button
                className={styles.tagFilterClear}
                onClick={() => setTagFilter([])}
              >
                絞り込みを解除
              </button>
            </>
          )}
        </div>
      )}

      <div className={styles.grid} data-selected={selected ? "" : undefined}>
        <div className={styles.projects}>
          {listedByTag.map((p) => {
            const pr = projectProgress(
              tasks.filter((t) => t.project_id === p.id),
            );
            return (
              <button
                key={p.id}
                className={styles.project}
                data-on={selected?.id === p.id ? "" : undefined}
                data-done={isProjectDone(p) ? "" : undefined}
                onClick={() => {
                  setSelId(p.id);
                  setForm(null);
                }}
              >
                <span className={styles.projectTop}>
                  <span className={styles.projectName}>
                    {isProjectDone(p) && (
                      <svg
                        aria-label="完了"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                    <span>{p.name}</span>
                  </span>
                  <span className={styles.mono}>
                    {pr.done}/{pr.total}
                  </span>
                </span>
                <TagChips
                  tags={p.tags}
                  max={3}
                  size="row"
                  active={activeTags}
                  onSurface={selected?.id === p.id}
                />
                <span className={styles.bar}>
                  <i style={{ width: `${pr.pct}%` }} />
                </span>
              </button>
            );
          })}
          {activeTags.length > 0 && listedByTag.length === 0 && (
            <>
              {/* デスクトップ: 一覧に1行、右の詳細側に説明とボタン */}
              <div className={styles.noMatch}>該当する{PREFIX}はありません</div>
              {/* モバイル: 詳細が出ないので、一覧に説明とボタンまで出す */}
              <div className={styles.noMatchFull}>{noMatchEmpty}</div>
            </>
          )}
          <button
            className={styles.outline}
            onClick={() => {
              setForm({
                mode: "create",
                name: "",
                description: "",
                tags: [],
                tagDraft: "",
              });
            }}
          >
            ＋ 新しい{PREFIX}
          </button>
        </div>

        <div className={styles.detail}>
          {listed.length === 0 && projects.length === 0 ? (
            <OrganizeEmpty
              title={`${PREFIX}はまだありません`}
              text="関連するタスクをまとめると、進み具合が見えるようになります。"
            />
          ) : activeTags.length > 0 && listedByTag.length === 0 ? (
            noMatchEmpty
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
                  <span className={styles.headerNameRow}>
                    <span
                      className={styles.headerName}
                      data-done={completed ? "" : undefined}
                    >
                      {selected.name}
                    </span>
                    <TagChips tags={selected.tags} size="header" />
                  </span>
                  {completed && <span className={styles.badge}>完了済み</span>}
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
                <div className={styles.headerActions}>
                  <button
                    className={styles.action}
                    onClick={() =>
                      setForm({
                        mode: "edit",
                        name: selected.name,
                        description: selected.description ?? "",
                        tags: selected.tags,
                        tagDraft: "",
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
                  {completed ? (
                    <button
                      className={styles.action}
                      onClick={() => void reopen(selected)}
                    >
                      未完了に戻す
                    </button>
                  ) : (
                    <button
                      className={styles.action}
                      onClick={() => void requestComplete(selected)}
                    >
                      完了にする
                    </button>
                  )}
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
