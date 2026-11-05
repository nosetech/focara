"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  DOT_TITLE,
  defaultRule,
  dotCounts,
  draftBody,
  draftFromHabit,
  draftSummary,
  emptyDraft,
  fixedTimeError,
  maxDayOfMonth,
  recentDots,
  slotName,
  type Habit,
  type HabitBody,
  type HabitDraft,
  type HabitRule,
} from "@/lib/habits";
import { PRIORITIES } from "@/lib/inbox";
import { slotForTime } from "@/lib/fixed";
import { SLOTS } from "@/lib/run";
import {
  PROPERTY_TYPES,
  SAVE_LABEL,
  WEEKDAYS,
  type SaveState,
} from "@/lib/taskDetail";
import styles from "./TaskDetail.module.css";
import own from "./HabitSheet.module.css";

const SAVE_DEBOUNCE_MS = 600;
/** 曜日ボタンは月曜始まりで並べる */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const RULE_TYPES: { key: HabitRule["type"]; label: string }[] = [
  { key: "daily", label: "毎日" },
  { key: "weekly", label: "曜日" },
  { key: "monthly", label: "月" },
  { key: "yearly", label: "年" },
];
const END_TYPES = [
  { key: "none", label: "なし" },
  { key: "count", label: "累計回数" },
  { key: "date", label: "終了日" },
] as const;

export interface HabitSheetProps {
  variant: "sheet" | "panel";
  mode: "new" | "edit";
  /** edit: 編集する親 */
  habit?: Habit;
  /** new: 初期値(inboxのタスクから作る場合など) */
  seed?: Partial<HabitDraft>;
  fromInbox?: boolean;
  projects: { id: number; name: string }[];
  onChanged?: (habit: Habit) => void;
  onCreated?: (habit: Habit) => void;
  onDeleted?: () => void;
  onClose: () => void;
}

const errMessage = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "保存できませんでした";

const Chevron = ({ up }: { up: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
  </svg>
);

/**
 * プロパティの項目名の編集。名前だけを持ち、値は子タスクの詳細で入力する。
 * 空・重複の入力中は、その行にエラーを出して確定(保存)しない。
 */
function PropertyRows({
  props,
  onChange,
}: {
  props: HabitDraft["properties"];
  onChange: (props: HabitDraft["properties"]) => void;
}) {
  // 確定できない入力中の項目名(行番号 → 文字列)
  const [bad, setBad] = useState<Record<number, string>>({});
  const commit = (next: HabitDraft["properties"]) => {
    setBad({});
    onChange(next);
  };
  const patch = (i: number, p: Partial<HabitDraft["properties"][number]>) =>
    commit(props.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => {
    const next = [...props];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    commit(next);
  };
  return (
    <div className={own.props}>
      {props.map((prop, i) => {
        const val = i in bad ? bad[i] : prop.key;
        const err =
          i in bad
            ? bad[i].trim()
              ? "同じ名前の項目があります"
              : "項目名を入力してください"
            : "";
        return (
          <div key={i} className={own.propCell}>
            <div className={own.propRow}>
              <input
                className={styles.input}
                value={val}
                placeholder="項目名"
                aria-label="項目名"
                aria-invalid={err ? true : undefined}
                data-bad={err ? "" : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  const t = v.trim();
                  if (!t || props.some((k, j) => j !== i && k.key === t)) {
                    setBad({ ...bad, [i]: v });
                    return;
                  }
                  patch(i, { key: t });
                }}
              />
              <button
                className={own.iconBtn}
                aria-label="上へ"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <Chevron up />
              </button>
              <button
                className={own.iconBtn}
                aria-label="下へ"
                disabled={i === props.length - 1}
                onClick={() => move(i, 1)}
              >
                <Chevron up={false} />
              </button>
              <button
                className={own.iconBtn}
                aria-label="削除"
                onClick={() => commit(props.filter((_, j) => j !== i))}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            {err && (
              <span className={own.propError} role="alert">
                {err}
              </span>
            )}
            <div className={own.typeRow}>
              <div className={styles.seg} role="group" aria-label="種別">
                {PROPERTY_TYPES.map((t) => (
                  <button
                    key={t.key}
                    data-on={prop.type === t.key ? "" : undefined}
                    onClick={() =>
                      patch(i, {
                        type: t.key,
                        unit: t.key === "number" ? prop.unit : "",
                      })
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {prop.type === "number" && (
                <>
                  <span className={own.tiny}>単位</span>
                  <input
                    className={styles.input}
                    style={{ width: 72 }}
                    value={prop.unit}
                    placeholder="kg"
                    aria-label="単位"
                    onChange={(e) => patch(i, { unit: e.target.value })}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      <button
        className={own.addBtn}
        onClick={() => {
          let n = props.length + 1;
          while (props.some((p) => p.key === `項目${n}`)) n++;
          commit([...props, { key: `項目${n}`, type: "string", unit: "" }]);
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
        項目を追加
      </button>
      <span className={own.propNote}>値は子タスクの詳細で入力します</span>
    </div>
  );
}

/** 習慣(親)の作成・編集シート。モバイルはボトムシート、デスクトップは右ペイン。 */
export function HabitSheet({
  variant,
  mode,
  habit,
  seed,
  fromInbox = false,
  projects,
  onChanged,
  onCreated,
  onDeleted,
  onClose,
}: HabitSheetProps) {
  const isNew = mode === "new";
  const [draft, setDraft] = useState<HabitDraft>(() =>
    habit && !isNew ? draftFromHabit(habit) : emptyDraft(new Date(), seed),
  );
  const [current, setCurrent] = useState<Habit | undefined>(habit);
  const [save, setSave] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);
  const [today] = useState(() => new Date());

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef<HabitBody | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const habitId = habit?.id;

  useEffect(() => {
    if (isNew) titleRef.current?.focus();
  }, [isNew]);

  // 累計の実施回数(完了の記録)
  useEffect(() => {
    if (isNew || habitId == null) return;
    let alive = true;
    apiFetch<unknown[]>("/logs", {
      query: { habit_id: habitId, action: "completed" },
    })
      .then((logs) => alive && setTotal(logs.length))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isNew, habitId]);

  /** 未送信の変更を順番に送る。 */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const body = dirty.current;
    if (!body || habitId == null) return chain.current;
    dirty.current = null;
    setSave("saving");
    chain.current = chain.current.then(async () => {
      try {
        const next = await apiFetch<Habit>(`/habits/${habitId}`, {
          method: "PATCH",
          body,
        });
        setCurrent(next);
        onChanged?.(next);
        setError(null);
        setSave(dirty.current ? "saving" : "saved");
      } catch (e) {
        setError(errMessage(e));
        setSave("error");
      }
    });
    return chain.current;
  }, [habitId, onChanged]);

  // 閉じる・切替時に未送信分を送る
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => () => void flushRef.current(), []);

  const change = (patch: Partial<HabitDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (isNew) return;
    const result = draftBody(next);
    if ("error" in result) {
      setError(result.error);
      setSave("error");
      dirty.current = null;
      clearTimeout(timer.current);
      return;
    }
    setError(null);
    setSave("saving");
    dirty.current = result.body;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  };

  /** 終了時刻が開始以前で確定できない入力(エラー表示用) */
  const [endBad, setEndBad] = useState<string | null>(null);
  /** 開始時刻があれば、枠は開始時刻から決まる。 */
  const slotShown =
    draft.fixedStart && !fixedTimeError(draft.fixedStart, "")
      ? slotForTime(draft.fixedStart)
      : draft.slot;

  const changeStart = (v: string) => {
    if (!v) {
      setEndBad(null);
      change({ fixedStart: "", fixedEnd: "" });
      return;
    }
    const end = endBad ?? draft.fixedEnd;
    const endOk = end !== "" && end > v;
    setEndBad(end !== "" && !endOk ? end : null);
    change({ fixedStart: v, fixedEnd: endOk ? end : "", slot: slotForTime(v) });
  };
  const changeEnd = (v: string) => {
    if (v && v <= draft.fixedStart) {
      setEndBad(v);
      return;
    }
    setEndBad(null);
    change({ fixedEnd: v });
  };

  const setRule = (p: Partial<HabitRule>) =>
    change({ rule: { ...draft.rule, ...p } as HabitRule });

  const close = () => {
    void flush();
    onClose();
  };

  useEffect(() => {
    if (variant === "panel") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const create = async () => {
    const result = draftBody(draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<Habit>("/habits", {
        method: "POST",
        body: result.body,
      });
      onCreated?.(created);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await flush();
      const next = await apiFetch<Habit>(
        `/habits/${current.id}/${current.active ? "pause" : "resume"}`,
        { method: "POST" },
      );
      setCurrent(next);
      onChanged?.(next);
      setError(null);
    } catch (e) {
      setError(errMessage(e));
      setSave("error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!current) return;
    setBusy(true);
    try {
      clearTimeout(timer.current);
      dirty.current = null;
      await chain.current;
      await apiFetch(`/habits/${current.id}`, { method: "DELETE" });
      onDeleted?.();
    } catch (e) {
      setConfirmDelete(false);
      setError(errMessage(e));
      setSave("error");
    } finally {
      setBusy(false);
    }
  };

  const rule = draft.rule;
  const paused = !isNew && current != null && !current.active;
  const dots = current ? recentDots(current.recent, today) : [];
  const { done, total: counted, cancelled: cancelledCount } = dotCounts(dots);
  const days = rule.type === "weekly" ? rule.days : [];
  const mdayNote = rule.type === "monthly" && (rule.mday ?? 0) > 28;
  const bodyError = draftBody(draft);

  return (
    <div className={styles.root} data-variant={variant}>
      {variant === "sheet" && (
        <div className={styles.backdrop} onClick={close} />
      )}
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal={variant === "sheet"}
        aria-label={isNew ? "新しい習慣" : "習慣の編集"}
      >
        {variant === "sheet" && <div className={styles.grabber} />}
        <div className={styles.top}>
          <div className={own.head}>
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
            <span>{isNew ? "新しい習慣" : "習慣"}</span>
            {!isNew && (
              <>
                <span className={own.sep} />
                <span
                  className={styles.save}
                  data-state={save}
                  role="status"
                  style={{ gap: 6 }}
                >
                  {SAVE_LABEL[save]}
                </span>
              </>
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

        <div className={styles.body}>
          {isNew && fromInbox && (
            <div className={own.note}>
              inboxのタスクから作成します。作成すると、元のタスクはinboxから取り除かれます。
            </div>
          )}
          {error && (
            <div className={styles.alert} role="alert">
              {error}
            </div>
          )}
          <textarea
            ref={titleRef}
            className={styles.titleInput}
            value={draft.title}
            rows={2}
            placeholder="習慣の名前(例: 朝の散歩)"
            aria-label="習慣の名前"
            onChange={(e) => change({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />

          {paused && (
            <div className={own.paused}>
              <span>
                <b>一時停止中</b> · 再開するまで子タスクは作られません
              </span>
              <button
                className={styles.secondary}
                style={{ height: 36, padding: "0 14px", borderRadius: 9 }}
                disabled={busy}
                onClick={() => void togglePause()}
              >
                再開
              </button>
            </div>
          )}

          {!isNew && (
            <div className={own.stat}>
              <div className={own.dots} aria-label="直近7回の実施状況">
                {dots.map((x, i) => (
                  <i key={i} data-state={x} title={DOT_TITLE[x]} />
                ))}
              </div>
              <span>
                直近7回 {done}/{counted}
                {cancelledCount > 0 && `(キャンセル${cancelledCount}を含む)`} ·
                累計 {total}回
              </span>
            </div>
          )}

          <div className={styles.list}>
            <div className={styles.item}>
              <span className={styles.itemLabel}>プロジェクト</span>
              <select
                className={`${styles.input} ${styles.grow}`}
                value={draft.projectId ?? ""}
                aria-label="プロジェクト"
                onChange={(e) =>
                  change({
                    projectId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">なし</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className={`${styles.item} ${styles.tall}`}>
              <span className={styles.itemLabel}>優先度</span>
              <div className={styles.seg} role="group" aria-label="優先度">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.value}
                    style={{ width: 52 }}
                    data-on={draft.priority === p.value ? "" : undefined}
                    onClick={() =>
                      change({
                        priority: draft.priority === p.value ? null : p.value,
                      })
                    }
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
                value={draft.estimate ?? ""}
                aria-label="見積もり(分)"
                onChange={(e) =>
                  change({
                    estimate:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
              <span className={styles.unit}>分</span>
            </div>
            <div className={own.block}>
              <div
                className={own.blockRow}
                style={{ alignItems: "flex-start" }}
              >
                <span
                  className={styles.itemLabel}
                  style={{ lineHeight: "36px" }}
                >
                  プロパティ
                </span>
                <PropertyRows
                  props={draft.properties}
                  onChange={(properties) => change({ properties })}
                />
              </div>
            </div>
            <div className={own.block}>
              <div className={own.blockRow}>
                <span className={styles.itemLabel}>予定時刻</span>
                <div className={own.timeRow}>
                  <span className={own.tiny}>開始</span>
                  <input
                    type="time"
                    className={`${styles.input} ${styles.mono}`}
                    value={draft.fixedStart}
                    aria-label="開始時刻"
                    onChange={(e) => changeStart(e.target.value)}
                  />
                  <span className={styles.unit}>〜</span>
                  <span className={own.tiny}>終了</span>
                  <input
                    type="time"
                    className={`${styles.input} ${styles.mono}`}
                    style={{
                      opacity: draft.fixedStart ? 1 : 0.45,
                      borderColor: endBad != null ? "var(--danger)" : undefined,
                    }}
                    value={endBad ?? draft.fixedEnd}
                    disabled={!draft.fixedStart}
                    aria-label="終了時刻"
                    aria-invalid={endBad != null ? true : undefined}
                    onChange={(e) => changeEnd(e.target.value)}
                  />
                </div>
              </div>
              {(endBad != null || !draft.fixedStart) && (
                <span
                  className={own.timeNote}
                  style={
                    endBad != null ? { color: "var(--danger)" } : undefined
                  }
                  role={endBad != null ? "alert" : undefined}
                >
                  {endBad != null
                    ? "終了は開始より後の時刻にしてください"
                    : "開始を入れると終了も指定できます(どちらも任意)"}
                </span>
              )}
            </div>
            <div className={`${styles.item} ${styles.tall}`}>
              <span className={styles.itemLabel}>既定の枠</span>
              <div
                className={`${styles.seg} ${styles.grow}`}
                role="group"
                aria-label="既定の枠"
                style={draft.fixedStart ? { opacity: 0.45 } : undefined}
              >
                {SLOTS.map((s) => (
                  <button
                    key={s.key}
                    disabled={draft.fixedStart !== ""}
                    data-on={slotShown === s.key ? "" : undefined}
                    onClick={() =>
                      change({ slot: draft.slot === s.key ? null : s.key })
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {draft.fixedStart !== "" && (
              <div className={own.slotNote}>
                開始時刻から{slotName(slotShown)}に作成します
              </div>
            )}
          </div>

          <div className={styles.label} style={{ marginTop: 22 }}>
            繰り返し
          </div>
          <div
            className={styles.seg}
            style={{ marginTop: 8 }}
            role="group"
            aria-label="繰り返し"
          >
            {RULE_TYPES.map((t) => (
              <button
                key={t.key}
                data-on={rule.type === t.key ? "" : undefined}
                onClick={() =>
                  change({ rule: defaultRule(t.key, draft.start, rule) })
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          {rule.type === "weekly" && (
            <div className={styles.field} style={{ marginTop: 14 }}>
              <span className={styles.fieldLabel}>曜日(複数選択)</span>
              <div className={styles.days}>
                {DAY_ORDER.map((i) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={i}
                      data-on={on ? "" : undefined}
                      aria-pressed={on}
                      onClick={() => {
                        if (on && days.length === 1) return;
                        setRule({
                          days: on ? days.filter((d) => d !== i) : [...days, i],
                        });
                      }}
                    >
                      {WEEKDAYS[i]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {rule.type === "monthly" && (
            <div className={styles.field} style={{ marginTop: 14 }}>
              <span className={styles.fieldLabel}>日にち</span>
              <div className={styles.grid}>
                {Array.from({ length: 31 }, (_, k) => k + 1).map((d) => (
                  <button
                    key={d}
                    className={styles.cell}
                    data-on={rule.mday === d ? "" : undefined}
                    onClick={() => setRule({ mday: d })}
                  >
                    {d}
                  </button>
                ))}
                <button
                  className={`${styles.cell} ${styles.cellLast}`}
                  data-on={rule.mday == null ? "" : undefined}
                  onClick={() => setRule({ mday: null })}
                >
                  月末
                </button>
              </div>
              {mdayNote && (
                <span className={styles.fieldNote}>
                  その日がない月は月末に作成します。
                </span>
              )}
            </div>
          )}

          {rule.type === "yearly" && (
            <div className={styles.field} style={{ marginTop: 14 }}>
              <span className={styles.fieldLabel}>月と日</span>
              <div className={own.ymd}>
                <select
                  className={`${styles.input} ${styles.mono}`}
                  style={{ width: 84 }}
                  value={rule.month}
                  aria-label="月"
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    change({
                      rule: {
                        type: "yearly",
                        month: m,
                        day: Math.min(rule.day, maxDayOfMonth(m)),
                      },
                    });
                  }}
                >
                  {Array.from({ length: 12 }, (_, k) => k + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <span className={styles.unit}>月</span>
                <select
                  className={`${styles.input} ${styles.mono}`}
                  style={{ width: 84, marginLeft: 6 }}
                  value={rule.day}
                  aria-label="日"
                  onChange={(e) => setRule({ day: Number(e.target.value) })}
                >
                  {Array.from(
                    { length: maxDayOfMonth(rule.month) },
                    (_, k) => k + 1,
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className={styles.unit}>日</span>
              </div>
            </div>
          )}

          <div className={styles.list} style={{ marginTop: 18 }}>
            <div className={styles.item}>
              <span className={styles.itemLabel}>開始日</span>
              <input
                type="date"
                className={`${styles.input} ${styles.mono} ${styles.grow}`}
                value={draft.start}
                aria-label="開始日"
                onChange={(e) => change({ start: e.target.value })}
              />
            </div>
            <div className={own.endBlock}>
              <div className={own.endRow}>
                <span className={styles.itemLabel}>終了条件</span>
                <div
                  className={`${styles.seg} ${styles.grow}`}
                  role="group"
                  aria-label="終了条件"
                >
                  {END_TYPES.map((t) => (
                    <button
                      key={t.key}
                      style={{ whiteSpace: "nowrap" }}
                      data-on={draft.end.type === t.key ? "" : undefined}
                      onClick={() =>
                        change({
                          end:
                            t.key === "count"
                              ? { type: "count", count: 30 }
                              : t.key === "date"
                                ? { type: "date", date: "" }
                                : { type: "none" },
                        })
                      }
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              {draft.end.type === "count" && (
                <div className={own.endDetail}>
                  <span className={styles.unit}>累計</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className={`${styles.input} ${styles.mono}`}
                    style={{ width: 80 }}
                    value={draft.end.count ?? ""}
                    aria-label="終了までの累計回数"
                    onChange={(e) =>
                      change({
                        end: {
                          type: "count",
                          count:
                            e.target.value === ""
                              ? null
                              : Math.max(1, Number(e.target.value)),
                        },
                      })
                    }
                  />
                  <span className={styles.unit}>回で終了</span>
                </div>
              )}
              {draft.end.type === "date" && (
                <div className={own.endDetail}>
                  <input
                    type="date"
                    className={`${styles.input} ${styles.mono} ${styles.grow}`}
                    min={draft.start}
                    value={draft.end.date}
                    aria-label="終了日"
                    onChange={(e) =>
                      change({ end: { type: "date", date: e.target.value } })
                    }
                  />
                  <span className={styles.unit}>まで</span>
                </div>
              )}
            </div>
            <div className={own.endBlock}>
              <div className={own.endRow}>
                <span className={styles.itemLabel}>期限切れの子</span>
                <div
                  className={`${styles.seg} ${styles.grow}`}
                  role="group"
                  aria-label="期限切れの子の扱い"
                >
                  <button
                    style={{ whiteSpace: "nowrap" }}
                    data-on={!draft.autoCancel ? "" : undefined}
                    onClick={() => change({ autoCancel: false })}
                  >
                    繰り越す
                  </button>
                  <button
                    style={{ whiteSpace: "nowrap" }}
                    data-on={draft.autoCancel ? "" : undefined}
                    onClick={() => change({ autoCancel: true })}
                  >
                    自動でキャンセル
                  </button>
                </div>
              </div>
              <div
                className={own.endDetail}
                style={{ color: "var(--ink3)", fontSize: 12 }}
              >
                {draft.autoCancel
                  ? "その日のうちに終えなかった子は、翌日に自動でキャンセルになります"
                  : "その日のうちに終えなかった子は、翌日以降も残ります"}
              </div>
            </div>
          </div>
          <div className={styles.summary} style={{ marginTop: 14 }}>
            {draftSummary(draft, total)}
          </div>
        </div>

        <div className={styles.footer}>
          {confirmDelete ? (
            <div className={own.confirm}>
              <div className={own.confirmTitle}>この習慣を削除しますか?</div>
              <div className={own.confirmText}>
                今日以降のまだ終えていない子タスクも削除されます。完了した記録は残ります。
              </div>
              <div className={own.confirmActions}>
                <button
                  className={styles.secondary}
                  onClick={() => setConfirmDelete(false)}
                >
                  キャンセル
                </button>
                <button
                  className={own.dangerSolid}
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  削除する
                </button>
              </div>
            </div>
          ) : isNew ? (
            <>
              <button
                className={styles.del}
                style={{ padding: "0 10px" }}
                onClick={close}
              >
                キャンセル
              </button>
              <button
                className={styles.primaryBtn}
                disabled={busy || "error" in bodyError}
                onClick={() => void create()}
              >
                習慣を作成
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
              <button
                className={styles.secondary}
                disabled={busy}
                onClick={() => void togglePause()}
              >
                {paused ? "再開" : "一時停止"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
