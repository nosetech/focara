"use client";

import { assignableProjects } from "@/lib/projects";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { habitRuleText, slotName, type Habit } from "@/lib/habits";
import { fixedBody, splitFixed, withDate, type FixedDraft } from "@/lib/fixed";
import { PRIORITIES } from "@/lib/inbox";
import { SLOTS, postponeBody, type TimeSlot } from "@/lib/run";
import {
  PROPERTY_TYPES,
  SAVE_LABEL,
  STATUS_CHIPS,
  commitTitle,
  newDraft,
  propertyBody,
  waitingBody,
  toDraft,
  type PropertyDraft,
  type PropertyType,
  type SaveState,
  type TaskProperty,
} from "@/lib/taskDetail";
import { formatDuration } from "@/lib/duration";
import { DateInput } from "./DateInput";
import { DetailResizeHandle } from "./DetailResizeHandle";
import { useDetailWidth } from "./useDetailWidth";
import styles from "./TaskDetail.module.css";

const MEMO_DEBOUNCE_MS = 800;

interface TaskData {
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
  habit_id: number | null;
  occurrence_date: string | null;
}

interface ProjectOption {
  id: number;
  name: string;
  completed_at?: string | null;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready" };

/** 詳細から「習慣にする」を押したときに渡す、現在のタスクの内容。 */
export interface HabitSource {
  id: number;
  title: string;
  project_id: number | null;
  priority: number | null;
  estimate_minutes: number | null;
}

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
/** PC幅のシートの既定幅(px) */
const SHEET_DEFAULT_WIDTH = 420;

export function TaskDetail({
  taskId,
  onClose,
  onMakeHabit,
  variant = "sheet",
}: {
  taskId: number;
  onClose: () => void;
  /** 渡すと、inbox のタスクに「習慣にする」を出す。保存を終えてから現在の内容で呼ぶ */
  onMakeHabit?: (src: HabitSource) => void;
  /** sheet: 画面下から出るシート(モバイル)/ panel: 整理画面の右ペインに埋め込む */
  variant?: "sheet" | "panel";
}) {
  const sheetWidth = useDetailWidth(SHEET_DEFAULT_WIDTH);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const savedTitle = useRef("");
  const [status, setStatus] = useState("inbox");
  const [done, setDone] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [newProject, setNewProject] = useState<string | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [priority, setPriority] = useState<number | null>(null);
  const [estimate, setEstimate] = useState("");
  const estimateSaved = useRef("");
  const [cond, setCond] = useState("");
  const router = useRouter();
  // 習慣(親)から生成された子のとき、その親と、この回の既定の日付
  const [habit, setHabit] = useState<Habit | null>(null);
  const [occurrence, setOccurrence] = useState<string | null>(null);
  const [isChild, setIsChild] = useState(false);
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

  const seq = useRef(0);
  const pending = useRef(0);
  const chains = useRef(new Map<string, Promise<void>>());
  const rowIds = useRef(new Map<string, number>());
  const failed = useRef(new Map<string, () => Promise<void>>());
  const memoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const memoDirty = useRef<string | null>(null);
  const titleDirty = useRef<string | null>(null);
  const condTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // サーバーに保存済みのステータス・条件(保存失敗時に画面を戻す先)
  const savedStatus = useRef("inbox");
  const savedCond = useRef("");
  // 画面上の最新値(タイマー・アンマウント時に古いクロージャを見ないため)
  const liveStatus = useRef("inbox");
  const liveCond = useRef("");

  const fetchAll = useCallback(async () => {
    setLoad({ state: "loading" });
    try {
      const [task, props, projs] = await Promise.all([
        apiFetch<TaskData>(`/tasks/${taskId}`),
        apiFetch<TaskProperty[]>(`/tasks/${taskId}/properties`),
        apiFetch<ProjectOption[]>("/projects"),
      ]);
      const parent =
        task.habit_id != null
          ? await apiFetch<Habit>(`/habits/${task.habit_id}`).catch(() => null)
          : null;
      const f = splitFixed(
        task.fixed_at,
        task.fixed_end_at,
        task.scheduled_date,
      );
      setIsChild(task.habit_id != null);
      setHabit(parent);
      setOccurrence(task.occurrence_date);
      setTitle(task.title);
      savedTitle.current = task.title;
      setEditingTitle(false);
      setStatus(task.status);
      savedStatus.current = task.status;
      savedCond.current = task.wait_condition ?? "";
      liveStatus.current = task.status;
      liveCond.current = task.wait_condition ?? "";
      setDone(task.status === "done");
      setCancelled(task.status === "cancelled");
      setProjectId(task.project_id);
      setProjects(projs);
      setSlot(task.time_slot);
      setPriority(task.priority);
      estimateSaved.current =
        task.estimate_minutes == null ? "" : String(task.estimate_minutes);
      setEstimate(estimateSaved.current);
      setCond(task.wait_condition ?? "");
      setMemo(task.memo ?? "");
      setFixed(f);
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
      clearTimeout(condTimer.current);
      const wc = liveCond.current.trim();
      if (
        liveStatus.current === "waiting" &&
        wc &&
        !(savedStatus.current === "waiting" && savedCond.current === wc)
      )
        void apiFetch(`/tasks/${taskId}`, {
          method: "PATCH",
          body: { status: "waiting", wait_condition: wc },
        }).catch(() => {});
      if (memoDirty.current !== null)
        void apiFetch(`/tasks/${taskId}/memo`, {
          method: "PUT",
          body: { memo: memoDirty.current === "" ? null : memoDirty.current },
        }).catch(() => {});
      const t = titleDirty.current?.trim();
      titleDirty.current = null;
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
        patchRow(draft.localId, {
          id: saved.id,
          // 時間は保存値(秒)から HH:MM:SS に揃える(MM:SS 入力の補完など)
          ...(saved.value_type === "duration"
            ? { value: formatDuration(saved.value) }
            : {}),
        });
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
    // 予定時刻があるときの枠は、開始時刻から決まる(既に枠があっても更新する)
    if (result.slot) {
      body.time_slot = result.slot;
      setSlot(result.slot);
    }
    void run("fixed", async () => {
      await apiFetch(`/tasks/${taskId}`, { method: "PATCH", body });
    });
  };

  const pickSlot = (key: TimeSlot) => {
    if (slotLocked) return;
    const next = slot === key ? null : key;
    setSlot(next);
    void patchTask("slot", { time_slot: next });
  };

  const pickPriority = (value: number) => {
    const next = priority === value ? null : value;
    setPriority(next);
    void patchTask("priority", { priority: next });
  };

  const saveEstimate = () => {
    const n = estimate.trim() === "" ? null : Number(estimate);
    if (n != null && !(Number.isInteger(n) && n >= 0)) {
      // 不正な入力は保存せず、保存済みの値に戻す
      setEstimate(estimateSaved.current);
      return;
    }
    estimateSaved.current = n == null ? "" : String(n);
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

  /** ステータス(と条件)を保存する。失敗したら画面をサーバーの状態へ戻す。 */
  const saveStatus = useCallback(
    (body: Record<string, unknown>, next: { status: string; cond: string }) =>
      run("status", async () => {
        try {
          await apiFetch(`/tasks/${taskId}`, { method: "PATCH", body });
          savedStatus.current = next.status;
          savedCond.current = next.cond;
        } catch (e) {
          liveStatus.current = savedStatus.current;
          liveCond.current = savedCond.current;
          setStatus(savedStatus.current);
          setCond(savedCond.current);
          throw e;
        }
      }),
    [run, taskId],
  );

  /** 条件待ちの条件が入力済みで未保存なら保存する。 */
  const flushCond = useCallback(() => {
    clearTimeout(condTimer.current);
    if (liveStatus.current !== "waiting") return;
    const body = waitingBody(liveCond.current);
    if (
      !body ||
      (savedStatus.current === "waiting" &&
        savedCond.current === body.wait_condition)
    )
      return;
    void saveStatus(body, { status: "waiting", cond: body.wait_condition });
  }, [saveStatus]);

  /** ステータスを変える。条件待ちは待つ条件が入るまで保存しない(入力欄で案内する)。 */
  const pickStatus = (key: string) => {
    if (key === status || done) return;
    setStatus(key);
    liveStatus.current = key;
    if (key === "waiting") {
      flushCond();
      return;
    }
    clearTimeout(condTimer.current);
    void saveStatus({ status: key }, { status: key, cond: "" });
  };

  const onCond = (value: string) => {
    setCond(value);
    liveCond.current = value;
    clearTimeout(condTimer.current);
    condTimer.current = setTimeout(flushCond, MEMO_DEBOUNCE_MS);
  };

  const startEditTitle = () => setEditingTitle(true);

  /** 編集を確定する。空なら保存せず編集前の値に戻す。 */
  const commitTitleEdit = () => {
    const r = commitTitle(title, savedTitle.current);
    titleDirty.current = null;
    setTitle(r.title);
    setEditingTitle(false);
    if (r.save) {
      savedTitle.current = r.title;
      void patchTask("title", { title: r.title });
    }
  };

  const cancelTitleEdit = () => {
    titleDirty.current = null;
    setTitle(savedTitle.current);
    setEditingTitle(false);
  };

  const flush = () => {
    flushMemo();
    flushTitle();
    flushCond();
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
      // 先の保存に失敗していたら、編集内容を残すため閉じない
      if (failed.current.size > 0) {
        setSave("error");
        return;
      }
      await fn();
      onClose();
    } catch {
      setSave("error");
      failed.current.set("action", async () => {
        await fn();
        onClose();
      });
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

  /** 習慣の子をキャンセルする / キャンセルを取り消して未完了(next)に戻す。 */
  const cancelChild = () =>
    act(() =>
      apiFetch(`/tasks/${taskId}/transition`, {
        method: "POST",
        body: { status: cancelled ? "next" : "cancelled" },
      }),
    );

  /** 習慣の作成シートを開く。未送信の保存が終わり、成功してから現在の内容で呼ぶ。 */
  const makeHabit = async () => {
    if (!onMakeHabit) return;
    flush();
    setBusy(true);
    try {
      await Promise.all([...chains.current.values()]);
      if (failed.current.size > 0) {
        setSave("error");
        return;
      }
      const n =
        estimateSaved.current === "" ? null : Number(estimateSaved.current);
      onMakeHabit({
        id: taskId,
        title: title.trim(),
        project_id: projectId,
        priority,
        estimate_minutes: n,
      });
    } finally {
      setBusy(false);
    }
  };

  const postpone = () =>
    act(() =>
      apiFetch(`/tasks/${taskId}/postpone`, {
        method: "POST",
        body: postponeBody(new Date()),
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
    if (variant === "panel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // 予定時刻(開始)があるタスクの枠は、開始時刻に連動して決まり、変更できない
  const slotLocked = fixed.start !== "";

  // この回だけ日付・枠を既定から変えているか
  const occChanged =
    isChild &&
    ((occurrence != null && fixed.date !== occurrence) ||
      (habit != null && slot !== habit.time_slot));

  return (
    <div className={styles.root} data-variant={variant}>
      {variant === "sheet" && (
        <div className={styles.backdrop} onClick={close} />
      )}
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal={variant === "sheet"}
        aria-label="タスクの詳細"
        style={
          variant === "sheet"
            ? ({ "--detail-w": `${sheetWidth.width}px` } as CSSProperties)
            : undefined
        }
      >
        {variant === "sheet" && (
          <DetailResizeHandle
            edge="inside"
            width={sheetWidth.width}
            onChange={sheetWidth.setWidth}
            onCommit={sheetWidth.commit}
            onReset={sheetWidth.reset}
          />
        )}
        {variant === "sheet" && <div className={styles.grabber} />}
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
              {editingTitle ? (
                <div className={styles.titleEditRow}>
                  <textarea
                    className={styles.titleInput}
                    value={title}
                    rows={2}
                    autoFocus
                    placeholder="タスク名を入力"
                    aria-label="タスク名"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      titleDirty.current = e.target.value;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        commitTitleEdit();
                      } else if (e.key === "Escape") {
                        e.stopPropagation();
                        cancelTitleEdit();
                      }
                    }}
                    onBlur={commitTitleEdit}
                  />
                  <button
                    className={styles.titleSave}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={commitTitleEdit}
                  >
                    保存
                  </button>
                </div>
              ) : (
                <div className={styles.titleRow}>
                  <h2 className={styles.titleText}>{title}</h2>
                  <button
                    className={styles.titleEdit}
                    aria-label="タスク名を編集"
                    title="タスク名を編集"
                    onClick={startEditTitle}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
                    </svg>
                  </button>
                </div>
              )}
              {!isChild && (
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
                  {onMakeHabit && status === "inbox" && (
                    <button
                      className={styles.chipHabit}
                      disabled={busy || done || title.trim() === ""}
                      onClick={() => void makeHabit()}
                    >
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
                      >
                        <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />
                      </svg>
                      習慣にする
                    </button>
                  )}
                </div>
              )}
              {isChild && (
                <div className={styles.habitCard}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />
                  </svg>
                  <div className={styles.habitText}>
                    <span className={styles.habitKicker}>
                      習慣から生成
                      {cancelled && (
                        <span className={styles.cancelledTag}>
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            aria-hidden="true"
                          >
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                          この回はキャンセル済み
                        </span>
                      )}
                    </span>
                    <span className={styles.habitLine}>
                      {habit
                        ? `${habit.title} · ${habitRuleText(habit)}`
                        : "習慣"}
                    </span>
                  </div>
                  {habit && (
                    <button
                      className={styles.habitOpen}
                      onClick={() => {
                        flush();
                        router.push(`/organize/habits?open=${habit.id}`);
                      }}
                    >
                      習慣を開く
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </button>
                  )}
                </div>
              )}

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
                      {assignableProjects(projects, projectId).map((p) => (
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
                  <span className={styles.itemLabel}>
                    {isChild ? "日付(この回)" : "日付"}
                  </span>
                  <DateInput
                    inputClassName={`${styles.input} ${styles.mono} ${styles.grow}`}
                    value={fixed.date}
                    aria-label="日付"
                    onChange={(date) =>
                      // 日付を外すときは時刻も一緒に外す(日付なしの時刻指定はできない)
                      saveFixed(withDate(fixed, date))
                    }
                  />
                </div>

                <div className={`${styles.item} ${styles.tall}`}>
                  <span className={styles.itemLabel}>
                    {isChild ? "枠(この回)" : "枠"}
                  </span>
                  <div
                    className={`${styles.seg} ${styles.grow}`}
                    role="group"
                    aria-label="枠"
                  >
                    {SLOTS.map((s) => (
                      <button
                        key={s.key}
                        data-on={slot === s.key ? "" : undefined}
                        disabled={slotLocked}
                        onClick={() => pickSlot(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                {slotLocked && (
                  <div className={styles.slotNote}>
                    予定時刻に連動しています。変更するには予定時刻を外してください。
                  </div>
                )}

                {isChild && (
                  <div className={styles.occRow}>
                    <span className={styles.occNote}>
                      {occChanged
                        ? `この回だけ変更中(既定: ${occurrenceLabel(occurrence)} ${slotName(habit?.time_slot ?? null)})。次回以降は習慣の設定どおりです。`
                        : "日付と枠の変更はこの回だけに適用されます。次回以降は習慣の設定どおりです。"}
                    </span>
                    {occChanged && (
                      <button
                        className={styles.occReset}
                        onClick={() => {
                          // 予定時刻があるときは、枠も習慣の予定時刻に連動して戻る
                          saveFixed({
                            date: occurrence ?? fixed.date,
                            start: habit?.fixed_start_time ?? "",
                            end: habit?.fixed_end_time ?? "",
                          });
                          if (
                            habit &&
                            !habit.fixed_start_time &&
                            habit.time_slot !== slot
                          ) {
                            setSlot(habit.time_slot);
                            void patchTask("slot", {
                              time_slot: habit.time_slot,
                            });
                          }
                        }}
                      >
                        習慣の既定に戻す
                      </button>
                    )}
                  </div>
                )}
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

                {status === "waiting" && (
                  <div className={styles.item}>
                    <span className={styles.itemLabel}>待つ条件</span>
                    <input
                      className={`${styles.input} ${styles.grow}`}
                      value={cond}
                      placeholder="例: 田中さんから返信が来たら"
                      aria-label="待つ条件"
                      onChange={(e) => onCond(e.target.value)}
                      onBlur={flushCond}
                    />
                    {cond.trim() === "" && (
                      <span className={styles.hint} role="note">
                        条件を入力すると保存されます
                      </span>
                    )}
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
                        <DateInput
                          inputClassName={`${styles.input} ${styles.mono} ${styles.grow}`}
                          value={r.value}
                          aria-label="値"
                          onChange={(value) => {
                            patchRow(r.localId, { value });
                            saveRow({ ...r, value });
                          }}
                        />
                      ) : (
                        <input
                          className={`${styles.input} ${styles.mono} ${styles.grow} ${
                            r.value_type === "duration" && rowErrors[r.localId]
                              ? styles.invalid
                              : ""
                          }`}
                          value={r.value}
                          inputMode={
                            r.value_type === "number"
                              ? "decimal"
                              : r.value_type === "duration"
                                ? "numeric"
                                : undefined
                          }
                          placeholder={
                            r.value_type === "duration" ? "00:00:00" : "値"
                          }
                          aria-label={
                            r.value_type === "duration"
                              ? "値(時間 HH:MM:SS)"
                              : "値"
                          }
                          aria-invalid={
                            r.value_type === "duration" &&
                            !!rowErrors[r.localId]
                              ? true
                              : undefined
                          }
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
                    title={isChild ? "この回を削除" : "削除"}
                    aria-label={isChild ? "この回を削除" : "削除"}
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
                    {isChild ? null : "削除"}
                  </button>
                  {isChild && !done && !cancelled && (
                    <button
                      className={`${styles.secondary} ${styles.cancelBtn}`}
                      disabled={busy}
                      onClick={() => void cancelChild()}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                      キャンセル
                    </button>
                  )}
                  {!done && !cancelled && (
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
                    onClick={() =>
                      void (cancelled ? cancelChild() : complete())
                    }
                  >
                    {done || cancelled ? "未完了に戻す" : "完了"}
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

/** 「M/D(曜)」。日付がなければ空。 */
function occurrenceLabel(date: string | null): string {
  if (!date) return "";
  const d = new Date(`${date}T00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`;
}
