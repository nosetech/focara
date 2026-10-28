"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { fixedBody, splitFixed, type FixedDraft } from "@/lib/fixed";
import { PRIORITIES } from "@/lib/inbox";
import { SLOTS, type TimeSlot } from "@/lib/run";
import {
  MONTH_DAYS,
  PROPERTY_TYPES,
  SAVE_LABEL,
  STATUS_CHIPS,
  WEEKDAYS,
  defaultRepeat,
  newDraft,
  propertyBody,
  repeatBody,
  repeatFromTask,
  repeatSummary,
  toDraft,
  type RepeatDraft,
  type RepeatEndType,
  type RepeatSource,
  type RepeatType,
  type PropertyDraft,
  type PropertyType,
  type SaveState,
  type TaskProperty,
} from "@/lib/taskDetail";
import styles from "./TaskDetail.module.css";

const MEMO_DEBOUNCE_MS = 800;

interface TaskData extends RepeatSource {
  id: number;
  title: string;
  status: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
  memo: string | null;
  scheduled_date: string | null;
  time_slot: TimeSlot | null;
  fixed_at: string | null;
  fixed_end_at: string | null;
  wait_condition: string | null;
}

interface ProjectOption {
  id: number;
  name: string;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready" };

const END_TYPES: { key: RepeatEndType; label: string }[] = [
  { key: "none", label: "設定なし" },
  { key: "date", label: "日付" },
  { key: "count", label: "回数" },
];

const REPEAT_TYPES: { key: "" | RepeatType; label: string }[] = [
  { key: "", label: "なし" },
  { key: "weekly", label: "週次" },
  { key: "monthly", label: "月次" },
  { key: "yearly", label: "年次" },
];

const CLOSE_ICON = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** タスクをタップしたときに開く詳細(モバイルはボトムシート、デスクトップは右パネル)。 */
export function TaskDetail({
  taskId,
  onClose,
}: {
  taskId: number;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("inbox");
  const [done, setDone] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [priority, setPriority] = useState<number | null>(null);
  const [estimate, setEstimate] = useState("");
  const [cond, setCond] = useState("");
  const [repeat, setRepeat] = useState<RepeatDraft | null>(null);
  const [calMonth, setCalMonth] = useState(1);
  const [repeatError, setRepeatError] = useState<string | null>(null);
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<PropertyDraft[]>([]);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [save, setSave] = useState<SaveState>("saved");
  const [fixed, setFixed] = useState<FixedDraft>({
    date: "",
    start: "",
    end: "",
  });
  const [fixedError, setFixedError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasSlot = useRef(false);

  const seq = useRef(0);
  const pending = useRef(0);
  const chains = useRef(new Map<string, Promise<void>>());
  const rowIds = useRef(new Map<string, number>());
  const failed = useRef(new Map<string, () => Promise<void>>());
  const memoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const memoDirty = useRef<string | null>(null);
  const titleDirty = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const [task, props, projs] = await Promise.all([
        apiFetch<TaskData>(`/tasks/${taskId}`),
        apiFetch<TaskProperty[]>(`/tasks/${taskId}/properties`),
        apiFetch<ProjectOption[]>("/projects"),
      ]);
      const f = splitFixed(
        task.fixed_at,
        task.fixed_end_at,
        task.scheduled_date,
      );
      const rep = repeatFromTask(task);
      setTitle(task.title);
      setStatus(task.status);
      setDone(task.status === "done");
      setProjectId(task.project_id);
      setProjects(projs);
      setSlot(task.time_slot);
      setPriority(task.priority);
      setEstimate(
        task.estimate_minutes == null ? "" : String(task.estimate_minutes),
      );
      setCond(task.wait_condition ?? "");
      setRepeat(rep);
      setCalMonth(rep?.month ?? 1);
      setMemo(task.memo ?? "");
      setFixed(f);
      hasSlot.current = task.time_slot != null;
      rowIds.current = new Map(props.map((p) => [`p${p.id}`, p.id]));
      const drafts = props.map(toDraft);
      setRows(drafts);
      setOpenRows(
        new Set(
          drafts.filter((d) => d.value_type !== "string").map((d) => d.localId),
        ),
      );
      setLoad({ state: "ready" });
    } catch {
      setLoad({ state: "error" });
    }
  }, [taskId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  /** 保存を1件実行する。同じ name の保存は失敗時に再試行用として最新のものだけ残す。 */
  const run = useCallback((name: string, fn: () => Promise<void>) => {
    pending.current += 1;
    setSave("saving");
    // 同じ対象への保存は順番に実行する(POST完了前の再保存・削除や古い値の上書きを防ぐ)
    const prev = chains.current.get(name) ?? Promise.resolve();
    const next = prev.then(async () => {
      try {
        await fn();
        failed.current.delete(name);
      } catch {
        failed.current.set(name, fn);
      } finally {
        pending.current -= 1;
        if (pending.current === 0)
          setSave(failed.current.size > 0 ? "error" : "saved");
      }
    });
    chains.current.set(name, next);
    return next;
  }, []);

  /** タスク本体の項目を1つ保存する(PATCH)。 */
  const patchTask = useCallback(
    (name: string, body: Record<string, unknown>) =>
      run(name, async () => {
        await apiFetch(`/tasks/${taskId}`, { method: "PATCH", body });
      }),
    [run, taskId],
  );

  const putMemo = useCallback(
    (value: string) =>
      run("memo", async () => {
        await apiFetch(`/tasks/${taskId}/memo`, {
          method: "PUT",
          body: { memo: value === "" ? null : value },
        });
      }),
    [run, taskId],
  );

  const flushMemo = useCallback(() => {
    clearTimeout(memoTimer.current);
    if (memoDirty.current === null) return;
    const value = memoDirty.current;
    // 送信済みの値を閉じる時に再送しない。失敗時は再試行ボタンが同じ値を送り直す
    memoDirty.current = null;
    void putMemo(value);
  }, [putMemo]);

  const onMemo = (value: string) => {
    setMemo(value);
    memoDirty.current = value;
    clearTimeout(memoTimer.current);
    memoTimer.current = setTimeout(flushMemo, MEMO_DEBOUNCE_MS);
  };

  /** タイトルの未送信分を送る(空にはできないので、空のときは送らない)。 */
  const flushTitle = useCallback(() => {
    const value = titleDirty.current?.trim();
    titleDirty.current = null;
    if (value) void patchTask("title", { title: value });
  }, [patchTask]);

  // 閉じる・タスク切替時に未送信のメモ・タイトルを送る
  useEffect(() => {
    return () => {
      clearTimeout(memoTimer.current);
      if (memoDirty.current !== null)
        void apiFetch(`/tasks/${taskId}/memo`, {
          method: "PUT",
          body: { memo: memoDirty.current === "" ? null : memoDirty.current },
        }).catch(() => {});
      const t = titleDirty.current?.trim();
      if (t)
        void apiFetch(`/tasks/${taskId}`, {
          method: "PATCH",
          body: { title: t },
        }).catch(() => {});
    };
  }, [taskId]);

  const clearRowError = (localId: string) =>
    setRowErrors((e) => {
      const rest = { ...e };
      delete rest[localId];
      return rest;
    });

  const patchRow = (localId: string, patch: Partial<PropertyDraft>) =>
    setRows((rs) =>
      rs.map((r) => (r.localId === localId ? { ...r, ...patch } : r)),
    );

  /** 行を保存する。新規はPOST、既存はPATCHし、返ってきた id を行に反映する。 */
  const saveRow = (draft: PropertyDraft) => {
    const body = propertyBody(draft);
    clearRowError(draft.localId);
    if (body === null) {
      if (draft.id != null)
        setRowErrors((e) => ({
          ...e,
          [draft.localId]: "名前を入力してください",
        }));
      return;
    }
    if ("error" in body) {
      setRowErrors((e) => ({ ...e, [draft.localId]: body.error }));
      return;
    }
    void run(draft.localId, async () => {
      try {
        const id = rowIds.current.get(draft.localId);
        const saved =
          id == null
            ? await apiFetch<TaskProperty>(`/tasks/${taskId}/properties`, {
                method: "POST",
                body,
              })
            : await apiFetch<TaskProperty>(
                `/tasks/${taskId}/properties/${id}`,
                { method: "PATCH", body },
              );
        rowIds.current.set(draft.localId, saved.id);
        patchRow(draft.localId, { id: saved.id });
      } catch (e) {
        if (e instanceof ApiError && e.status === 409)
          setRowErrors((x) => ({
            ...x,
            [draft.localId]: "同じ名前のプロパティがあります",
          }));
        throw e;
      }
    });
  };

  const removeRow = (draft: PropertyDraft) => {
    setRows((rs) => rs.filter((r) => r.localId !== draft.localId));
    clearRowError(draft.localId);
    failed.current.delete(draft.localId);
    void run(draft.localId, async () => {
      const id = rowIds.current.get(draft.localId);
      if (id == null) return;
      try {
        await apiFetch(`/tasks/${taskId}/properties/${id}`, {
          method: "DELETE",
        });
        rowIds.current.delete(draft.localId);
      } catch (e) {
        // 失敗したら行を元に戻す
        setRows((rs) =>
          rs.some((r) => r.localId === draft.localId) ? rs : [...rs, draft],
        );
        throw e;
      }
    });
  };

  /** 日付・予定時刻を保存する。時刻があれば日時予定、無ければ日付だけを保存する。 */
  const saveFixed = (next: FixedDraft) => {
    setFixed(next);
    if (!next.start && !next.end) {
      setFixedError(null);
      void patchTask("fixed", {
        scheduled_date: next.date || null,
        fixed_at: null,
        fixed_end_at: null,
      });
      return;
    }
    const result = fixedBody(next);
    if ("error" in result) {
      setFixedError(result.error);
      return;
    }
    setFixedError(null);
    const body: Record<string, unknown> = { ...result.body };
    // 時間帯が未設定なら、開始時刻から実行画面で並ぶ枠を決める
    if (result.slot && !hasSlot.current) {
      body.time_slot = result.slot;
      setSlot(result.slot);
    }
    void run("fixed", async () => {
      await apiFetch(`/tasks/${taskId}`, { method: "PATCH", body });
      if (result.slot) hasSlot.current = true;
    });
  };

  const pickSlot = (key: TimeSlot) => {
    const next = slot === key ? null : key;
    setSlot(next);
    hasSlot.current = next != null;
    void patchTask("slot", { time_slot: next });
  };

  const pickPriority = (value: number) => {
    const next = priority === value ? null : value;
    setPriority(next);
    void patchTask("priority", { priority: next });
  };

  const saveEstimate = () => {
    const n = estimate.trim() === "" ? null : Number(estimate);
    if (n != null && !(Number.isInteger(n) && n >= 0)) return;
    void patchTask("estimate", { estimate_minutes: n });
  };

  const pickProject = (value: string) => {
    if (value === "__new") {
      setNewProject("");
      return;
    }
    const id = value === "" ? null : Number(value);
    setProjectId(id);
    void patchTask("project", { project_id: id });
  };

  const addProject = () => {
    const name = (newProject ?? "").trim();
    if (!name) return;
    setNewProject(null);
    void run("project", async () => {
      const p = await apiFetch<ProjectOption>("/projects", {
        method: "POST",
        body: { name },
      });
      setProjects((ps) => [...ps, p]);
      setProjectId(p.id);
      await apiFetch(`/tasks/${taskId}`, {
        method: "PATCH",
        body: { project_id: p.id },
      });
    });
  };

  /** ステータスを変える。条件待ちは待つ条件が入るまで保存しない。 */
  const pickStatus = (key: string) => {
    if (key === status || done) return;
    setStatus(key);
    if (key === "waiting") {
      if (cond.trim())
        void patchTask("status", { status: key, wait_condition: cond.trim() });
      return;
    }
    void patchTask("status", { status: key });
  };

  const saveCond = () => {
    if (status !== "waiting" || !cond.trim()) return;
    void patchTask("status", {
      status: "waiting",
      wait_condition: cond.trim(),
    });
  };

  /** 繰り返しを保存する。null なら解除する。 */
  const saveRepeat = (next: RepeatDraft | null) => {
    setRepeat(next);
    if (next === null) {
      setRepeatError(null);
      void run("repeat", async () => {
        await apiFetch(`/tasks/${taskId}/recurrence`, { method: "DELETE" });
      });
      return;
    }
    const result = repeatBody(next);
    if ("error" in result) {
      setRepeatError(result.error);
      return;
    }
    setRepeatError(null);
    void run("repeat", async () => {
      await apiFetch(`/tasks/${taskId}/recurrence`, {
        method: "PUT",
        body: result.body,
      });
    });
  };

  const pickRepeatType = (key: "" | RepeatType) => {
    setCalMonth(1);
    if (key === "") return saveRepeat(null);
    const next = defaultRepeat(key, fixed.date || null, repeat ?? undefined);
    setCalMonth(next.month);
    saveRepeat(next);
  };

  const flush = () => {
    flushMemo();
    flushTitle();
  };

  const close = () => {
    flush();
    onClose();
  };

  /** 完了・後回し・未完了に戻す。成功したら閉じる(呼び出し側が一覧を取り直す)。 */
  const act = async (fn: () => Promise<unknown>) => {
    flush();
    setBusy(true);
    try {
      // 未送信の保存が終わってから実行する
      await Promise.all([...chains.current.values()]);
      await fn();
      onClose();
    } catch {
      setSave("error");
      failed.current.set("action", async () => {});
    } finally {
      setBusy(false);
    }
  };

  const complete = () =>
    act(() =>
      done
        ? apiFetch(`/tasks/${taskId}`, {
            method: "PATCH",
            body: { status: "next" },
          })
        : apiFetch(`/tasks/${taskId}/complete`, { method: "POST" }),
    );

  const postpone = () =>
    act(() =>
      apiFetch(`/tasks/${taskId}/postpone`, {
        method: "POST",
        body: { target: "end_of_day" },
      }),
    );

  const deleteTask = async () => {
    try {
      await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
      onClose();
    } catch {
      setConfirmDelete(false);
      setSave("error");
    }
  };

  const retry = () => {
    if (failed.current.size === 0) setSave("saved");
    for (const [name, fn] of [...failed.current.entries()]) void run(name, fn);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const repeatMonthDays = MONTH_DAYS[(repeat?.month ?? 1) - 1];

  return (
    <div className={styles.root}>
      <div className={styles.backdrop} onClick={close} />
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label="タスクの詳細"
      >
        <div className={styles.grabber} />
        <div className={styles.top}>
          <div className={styles.save} data-state={save} role="status">
            <span className={styles.saveDot} />
            <span>{SAVE_LABEL[save]}</span>
            {save === "error" && (
              <button className={styles.retry} onClick={retry}>
                再試行
              </button>
            )}
          </div>
          <button className={styles.close} onClick={close} aria-label="閉じる">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {load.state === "loading" && (
          <div
            className={styles.skeleton}
            aria-busy="true"
            aria-label="読み込み中"
          >
            <i style={{ height: 24, width: "80%" }} />
            <i style={{ height: 24, width: "50%", marginTop: 14 }} />
            <div className={styles.skelChips}>
              <i style={{ height: 30, width: 64, borderRadius: 999 }} />
              <i style={{ height: 30, width: 80, borderRadius: 999 }} />
              <i style={{ height: 30, width: 56, borderRadius: 999 }} />
            </div>
            <div className={styles.skelLine} />
            <i style={{ height: 14, width: "70%", marginTop: 14 }} />
            <i style={{ height: 14, width: "60%", marginTop: 14 }} />
            <i style={{ height: 14, width: "75%", marginTop: 14 }} />
            <i style={{ height: 14, width: "55%", marginTop: 14 }} />
            <i style={{ height: 96, marginTop: 22, borderRadius: 10 }} />
          </div>
        )}

        {load.state === "error" && (
          <div className={styles.loadError} role="alert">
            <p>詳細を読み込めませんでした。</p>
            <button className={styles.primary} onClick={() => void fetchAll()}>
              再試行
            </button>
          </div>
        )}

        {load.state === "ready" && (
          <>
            <div className={styles.body}>
              {save === "error" && (
                <div className={styles.alert} role="alert">
                  変更がまだ保存されていません。「再試行」で送り直せます。
                </div>
              )}
              <textarea
                className={styles.titleInput}
                value={title}
                rows={2}
                placeholder="タスク名を入力"
                aria-label="タスク名"
                onChange={(e) => {
                  setTitle(e.target.value);
                  titleDirty.current = e.target.value;
                }}
                onBlur={flushTitle}
              />
              <div className={styles.chips}>
                {STATUS_CHIPS.map((c) => (
                  <button
                    key={c.key}
                    className={styles.chip}
                    data-on={status === c.key ? "" : undefined}
                    aria-pressed={status === c.key}
                    disabled={done}
                    onClick={() => pickStatus(c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <div className={styles.list}>
                <div className={styles.item}>
                  <span className={styles.itemLabel}>プロジェクト</span>
                  {newProject === null ? (
                    <select
                      className={`${styles.input} ${styles.grow}`}
                      value={projectId ?? ""}
                      aria-label="プロジェクト"
                      onChange={(e) => pickProject(e.target.value)}
                    >
                      <option value="">なし</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option disabled>──────────</option>
                      <option value="__new">
                        ＋ 新しいプロジェクトを追加…
                      </option>
                    </select>
                  ) : (
                    <div className={`${styles.grow} ${styles.inline}`}>
                      <input
                        className={`${styles.input} ${styles.grow}`}
                        autoFocus
                        value={newProject}
                        placeholder="プロジェクト名"
                        aria-label="新しいプロジェクト名"
                        onChange={(e) => setNewProject(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            addProject();
                          } else if (e.key === "Escape") {
                            e.stopPropagation();
                            setNewProject(null);
                          }
                        }}
                      />
                      <button
                        className={styles.solid}
                        disabled={!newProject.trim()}
                        onClick={addProject}
                      >
                        追加
                      </button>
                      <button
                        className={styles.ghost}
                        onClick={() => setNewProject(null)}
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>

                <div className={styles.item}>
                  <span className={styles.itemLabel}>日付</span>
                  <input
                    type="date"
                    className={`${styles.input} ${styles.mono} ${styles.grow}`}
                    value={fixed.date}
                    aria-label="日付"
                    onChange={(e) =>
                      saveFixed({ ...fixed, date: e.target.value })
                    }
                  />
                </div>

                <div className={`${styles.item} ${styles.tall}`}>
                  <span className={styles.itemLabel}>枠</span>
                  <div
                    className={`${styles.seg} ${styles.grow}`}
                    role="group"
                    aria-label="枠"
                  >
                    {SLOTS.map((s) => (
                      <button
                        key={s.key}
                        data-on={slot === s.key ? "" : undefined}
                        onClick={() => pickSlot(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.item}>
                  <span className={styles.itemLabel}>予定時刻</span>
                  <input
                    type="time"
                    className={`${styles.input} ${styles.mono}`}
                    style={{ width: 120 }}
                    value={fixed.start}
                    aria-label="開始時刻"
                    onChange={(e) =>
                      saveFixed({ ...fixed, start: e.target.value })
                    }
                  />
                  {fixed.start ? (
                    <button
                      className={styles.ghost}
                      onClick={() =>
                        saveFixed({ ...fixed, start: "", end: "" })
                      }
                    >
                      なしにする
                    </button>
                  ) : (
                    <span className={styles.hint}>任意</span>
                  )}
                </div>
                {fixed.start && (
                  <div className={styles.item}>
                    <span className={styles.itemLabel}>終了時刻</span>
                    <input
                      type="time"
                      className={`${styles.input} ${styles.mono}`}
                      style={{ width: 120 }}
                      value={fixed.end}
                      aria-label="終了時刻"
                      onChange={(e) =>
                        saveFixed({ ...fixed, end: e.target.value })
                      }
                    />
                    <span className={styles.hint}>任意</span>
                  </div>
                )}
                {fixedError && (
                  <div className={styles.rowError} role="alert">
                    {fixedError}
                  </div>
                )}

                <div className={`${styles.item} ${styles.tall}`}>
                  <span className={styles.itemLabel}>優先度</span>
                  <div className={styles.seg} role="group" aria-label="優先度">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.value}
                        style={{ width: 52 }}
                        data-on={priority === p.value ? "" : undefined}
                        onClick={() => pickPriority(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.item}>
                  <span className={styles.itemLabel}>見積もり</span>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    className={`${styles.input} ${styles.mono}`}
                    style={{ width: 80 }}
                    value={estimate}
                    aria-label="見積もり(分)"
                    onChange={(e) => setEstimate(e.target.value)}
                    onBlur={saveEstimate}
                  />
                  <span className={styles.unit}>分</span>
                </div>

                <div className={styles.itemBlock}>
                  <div className={styles.item} style={{ borderBottom: "none" }}>
                    <span className={styles.itemLabel}>繰り返し</span>
                    <select
                      className={`${styles.input} ${styles.grow}`}
                      value={repeat?.type ?? ""}
                      aria-label="繰り返し"
                      onChange={(e) =>
                        pickRepeatType(e.target.value as "" | RepeatType)
                      }
                    >
                      {REPEAT_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {repeat && (
                    <div className={styles.repeat}>
                      {repeat.type === "weekly" && (
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>
                            曜日(複数選択)
                          </span>
                          <div className={styles.days}>
                            {WEEKDAYS.map((l, i) => {
                              const on = repeat.days.includes(i);
                              return (
                                <button
                                  key={l}
                                  aria-pressed={on}
                                  data-on={on ? "" : undefined}
                                  onClick={() => {
                                    if (on && repeat.days.length === 1) return;
                                    saveRepeat({
                                      ...repeat,
                                      days: on
                                        ? repeat.days.filter((d) => d !== i)
                                        : [...repeat.days, i],
                                    });
                                  }}
                                >
                                  {l}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {repeat.type === "monthly" && (
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>日にち</span>
                          <div className={styles.grid}>
                            {Array.from({ length: 31 }, (_, i) => i + 1).map(
                              (d) => (
                                <button
                                  key={d}
                                  className={styles.cell}
                                  data-on={repeat.mday === d ? "" : undefined}
                                  onClick={() =>
                                    saveRepeat({ ...repeat, mday: d })
                                  }
                                >
                                  {d}
                                </button>
                              ),
                            )}
                            <button
                              className={`${styles.cell} ${styles.cellLast}`}
                              data-on={repeat.mday == null ? "" : undefined}
                              onClick={() =>
                                saveRepeat({ ...repeat, mday: null })
                              }
                            >
                              月末
                            </button>
                          </div>
                          {repeat.mday != null && repeat.mday > 28 && (
                            <span className={styles.fieldNote}>
                              その日がない月は月末に実行します。
                            </span>
                          )}
                        </div>
                      )}

                      {repeat.type === "yearly" && (
                        <div className={styles.field}>
                          <span className={styles.fieldLabel}>月と日</span>
                          <div className={styles.inline}>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={12}
                              className={`${styles.input} ${styles.mono}`}
                              style={{ width: 64 }}
                              aria-label="月"
                              value={repeat.month}
                              onChange={(e) => {
                                const n = Math.round(Number(e.target.value));
                                if (!(n >= 1 && n <= 12)) return;
                                setCalMonth(n);
                                saveRepeat({
                                  ...repeat,
                                  month: n,
                                  day: Math.min(repeat.day, MONTH_DAYS[n - 1]),
                                });
                              }}
                            />
                            <span className={styles.unit}>月</span>
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={repeatMonthDays}
                              className={`${styles.input} ${styles.mono}`}
                              style={{ width: 64, marginLeft: 6 }}
                              aria-label="日"
                              value={repeat.day}
                              onChange={(e) => {
                                const n = Math.round(Number(e.target.value));
                                if (!(n >= 1 && n <= repeatMonthDays)) return;
                                saveRepeat({ ...repeat, day: n });
                              }}
                            />
                            <span className={styles.unit}>日</span>
                          </div>
                          <div className={styles.cal}>
                            <div className={styles.calHead}>
                              <button
                                aria-label="前の月"
                                onClick={() =>
                                  setCalMonth((m) => (m === 1 ? 12 : m - 1))
                                }
                              >
                                ‹
                              </button>
                              <span>{calMonth}月</span>
                              <button
                                aria-label="次の月"
                                onClick={() =>
                                  setCalMonth((m) => (m === 12 ? 1 : m + 1))
                                }
                              >
                                ›
                              </button>
                            </div>
                            <div className={styles.grid}>
                              {Array.from(
                                { length: MONTH_DAYS[calMonth - 1] },
                                (_, i) => i + 1,
                              ).map((d) => (
                                <button
                                  key={d}
                                  className={`${styles.cell} ${styles.mono}`}
                                  data-on={
                                    repeat.month === calMonth &&
                                    repeat.day === d
                                      ? ""
                                      : undefined
                                  }
                                  onClick={() =>
                                    saveRepeat({
                                      ...repeat,
                                      month: calMonth,
                                      day: d,
                                    })
                                  }
                                >
                                  {d}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className={styles.field}>
                        <span className={styles.fieldLabel}>終了</span>
                        <div
                          className={styles.seg}
                          role="group"
                          aria-label="終了"
                        >
                          {END_TYPES.map((t) => (
                            <button
                              key={t.key}
                              style={{ flex: 1, width: "auto" }}
                              data-on={
                                repeat.endType === t.key ? "" : undefined
                              }
                              onClick={() =>
                                saveRepeat({
                                  ...repeat,
                                  endType: t.key,
                                  endDate:
                                    t.key === "date" && !repeat.endDate
                                      ? defaultEndDate(fixed.date)
                                      : repeat.endDate,
                                  endCount:
                                    t.key === "count" && repeat.endCount == null
                                      ? 10
                                      : repeat.endCount,
                                })
                              }
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        {repeat.endType === "date" && (
                          <div className={styles.inline}>
                            <input
                              type="date"
                              className={`${styles.input} ${styles.mono} ${styles.grow}`}
                              value={repeat.endDate}
                              min={fixed.date || undefined}
                              aria-label="終了日"
                              onChange={(e) =>
                                saveRepeat({
                                  ...repeat,
                                  endDate: e.target.value,
                                })
                              }
                            />
                            <span className={styles.unit}>まで</span>
                          </div>
                        )}
                        {repeat.endType === "count" && (
                          <div className={styles.inline}>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              className={`${styles.input} ${styles.mono}`}
                              style={{ width: 80 }}
                              value={repeat.endCount ?? ""}
                              aria-label="終了回数"
                              onChange={(e) =>
                                saveRepeat({
                                  ...repeat,
                                  endCount:
                                    e.target.value === ""
                                      ? null
                                      : Math.max(1, Number(e.target.value)),
                                })
                              }
                            />
                            <span className={styles.unit}>回で終了</span>
                          </div>
                        )}
                      </div>

                      {repeatError ? (
                        <div className={styles.rowError} role="alert">
                          {repeatError}
                        </div>
                      ) : (
                        <div className={styles.summary}>
                          {repeatSummary(repeat)}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {status === "waiting" && (
                  <div className={styles.item}>
                    <span className={styles.itemLabel}>待つ条件</span>
                    <input
                      className={`${styles.input} ${styles.grow}`}
                      value={cond}
                      placeholder="例: 田中さんから返信が来たら"
                      aria-label="待つ条件"
                      onChange={(e) => setCond(e.target.value)}
                      onBlur={saveCond}
                    />
                  </div>
                )}
              </div>

              <div className={styles.labelRow}>
                <span className={styles.label}>メモ</span>
                <span className={styles.hint}>Markdown</span>
              </div>
              <textarea
                className={styles.memo}
                value={memo}
                rows={5}
                placeholder="経緯、手順、リンクなど"
                onChange={(e) => onMemo(e.target.value)}
                onBlur={flushMemo}
              />

              <div className={styles.label} style={{ marginTop: 20 }}>
                カスタムプロパティ
              </div>
              <div className={styles.props}>
                {rows.map((r) => (
                  <div key={r.localId} className={styles.prop}>
                    <div className={styles.propRow}>
                      <input
                        className={styles.input}
                        style={{ width: 110 }}
                        value={r.key}
                        placeholder="名前"
                        aria-label="プロパティ名"
                        onChange={(e) =>
                          patchRow(r.localId, { key: e.target.value })
                        }
                        onBlur={() => saveRow(r)}
                      />
                      {r.value_type === "date" ? (
                        <input
                          type="date"
                          className={`${styles.input} ${styles.mono} ${styles.grow}`}
                          value={r.value}
                          aria-label="値"
                          onChange={(e) => {
                            patchRow(r.localId, { value: e.target.value });
                            saveRow({ ...r, value: e.target.value });
                          }}
                        />
                      ) : (
                        <input
                          className={`${styles.input} ${styles.mono} ${styles.grow}`}
                          value={r.value}
                          inputMode={
                            r.value_type === "number" ? "decimal" : undefined
                          }
                          placeholder="値"
                          aria-label="値"
                          onChange={(e) =>
                            patchRow(r.localId, { value: e.target.value })
                          }
                          onBlur={() => saveRow(r)}
                        />
                      )}
                      <button
                        className={styles.remove}
                        aria-label="種別・単位"
                        aria-expanded={openRows.has(r.localId)}
                        onClick={() =>
                          setOpenRows((s) => {
                            const next = new Set(s);
                            if (!next.delete(r.localId)) next.add(r.localId);
                            return next;
                          })
                        }
                      >
                        ⋯
                      </button>
                      <button
                        className={styles.remove}
                        aria-label="削除"
                        onClick={() => removeRow(r)}
                      >
                        {CLOSE_ICON}
                      </button>
                    </div>
                    {openRows.has(r.localId) && (
                      <div className={styles.propRow}>
                        <div
                          className={styles.seg}
                          role="group"
                          aria-label="種別"
                        >
                          {PROPERTY_TYPES.map((t) => (
                            <button
                              key={t.key}
                              data-on={r.value_type === t.key ? "" : undefined}
                              onClick={() => {
                                // 種別を変えると値の形式が合わなくなるため、値と単位は空に戻す。
                                // 値を入れ直して確定するまでは保存しない
                                patchRow(r.localId, {
                                  value_type: t.key as PropertyType,
                                  value: "",
                                  unit: "",
                                });
                                clearRowError(r.localId);
                              }}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        {r.value_type === "number" && (
                          <input
                            className={styles.input}
                            style={{ width: 72 }}
                            value={r.unit}
                            placeholder="単位"
                            aria-label="単位"
                            onChange={(e) =>
                              patchRow(r.localId, { unit: e.target.value })
                            }
                            onBlur={() => saveRow(r)}
                          />
                        )}
                      </div>
                    )}
                    {rowErrors[r.localId] && (
                      <div className={styles.rowError} role="alert">
                        {rowErrors[r.localId]}
                      </div>
                    )}
                  </div>
                ))}
                <button
                  className={styles.add}
                  onClick={() => {
                    seq.current += 1;
                    setRows((rs) => [...rs, newDraft(seq.current)]);
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  プロパティを追加
                </button>
              </div>
            </div>

            <div className={styles.footer}>
              {confirmDelete ? (
                <>
                  <span className={styles.confirmText}>
                    このタスクを削除します
                  </span>
                  <button
                    className={styles.ghost}
                    onClick={() => setConfirmDelete(false)}
                  >
                    取消
                  </button>
                  <button
                    className={styles.danger}
                    onClick={() => void deleteTask()}
                  >
                    削除する
                  </button>
                </>
              ) : (
                <>
                  <button
                    className={styles.del}
                    onClick={() => setConfirmDelete(true)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    >
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                    </svg>
                    削除
                  </button>
                  {!done && (
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => void postpone()}
                    >
                      後回し
                    </button>
                  )}
                  <button
                    className={styles.primaryBtn}
                    disabled={busy}
                    onClick={() => void complete()}
                  >
                    {done ? "未完了に戻す" : "完了"}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 終了日の初期値: 開始日(未設定なら今日)の約3か月後。 */
function defaultEndDate(date: string): string {
  const d = date ? new Date(`${date}T00:00`) : new Date();
  const e = new Date(d.getFullYear(), d.getMonth() + 3, d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${e.getFullYear()}-${p(e.getMonth() + 1)}-${p(e.getDate())}`;
}
