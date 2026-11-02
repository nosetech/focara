"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  DOT_TITLE,
  asListRow,
  dotCounts,
  habitRuleText,
  recentDots,
  slotName,
  type Habit,
  type HabitDraft,
} from "@/lib/habits";
import { filterInbox } from "@/lib/inbox";
import { HabitSheetHost } from "./HabitSheetHost";
import { useOrganize } from "./OrganizeContext";
import {
  OrganizeEmpty,
  OrganizeError,
  OrganizeLoading,
} from "./OrganizeStates";
import styles from "./InboxScreen.module.css";
import extra from "./StatusListScreen.module.css";
import own from "./HabitsScreen.module.css";

type Load = "loading" | "error" | "ready";
type Selection = number | "new" | null;

const EMPTY_TITLE = "習慣はまだありません";
const EMPTY_TEXT =
  "繰り返したいことを習慣にすると、決めた日の既定の枠にタスクが作られ、実施状況がここに記録されます。";

/** 整理画面の習慣(親)。一覧と、作成・編集・一時停止・削除。 */
export function HabitsScreen({
  seed,
}: {
  /** 新規作成シートの初期値(省略可) */
  seed?: Partial<HabitDraft>;
}) {
  const { filters, clearFilters, projects, refreshCounts, showToast } =
    useOrganize();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [sel, setSel] = useState<Selection>(null);
  const [today] = useState(() => new Date());

  const fetchAll = useCallback(
    async (initial: boolean) => {
      if (initial) setLoad("loading");
      try {
        setHabits(await apiFetch<Habit[]>("/habits"));
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
  }, [fetchAll]);

  // タスク詳細の「習慣を開く」から来たときは、その習慣を開く(?open=ID)
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("open"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isInteger(id) && id > 0) setSel(id);
  }, []);

  const projectName = useCallback(
    (id: number | null) => projects.find((p) => p.id === id)?.name ?? "",
    [projects],
  );
  const rows = useMemo(
    () =>
      filterInbox(habits.map(asListRow), filters, projectName).map((r) =>
        habits.find((h) => h.id === r.id),
      ) as Habit[],
    [habits, filters, projectName],
  );
  const current =
    typeof sel === "number" ? habits.find((h) => h.id === sel) : undefined;

  const replace = useCallback(
    (next: Habit) => {
      setHabits((hs) => hs.map((h) => (h.id === next.id ? next : h)));
      refreshCounts();
    },
    [refreshCounts],
  );

  if (load === "loading") return <OrganizeLoading />;
  if (load === "error")
    return <OrganizeError label="習慣" onRetry={() => void fetchAll(true)} />;

  const add = (
    <button className={styles.outline} onClick={() => setSel("new")}>
      習慣を追加
    </button>
  );

  return (
    <>
      {rows.length === 0 ? (
        habits.length === 0 ? (
          <div className={styles.empty}>
            <OrganizeEmpty title={EMPTY_TITLE} text={EMPTY_TEXT} />
            {add}
          </div>
        ) : (
          <div className={styles.empty}>
            <OrganizeEmpty
              title="条件に合う習慣はありません"
              text="絞り込みを変えるか、解除してください。"
            />
            <button className={styles.outline} onClick={clearFilters}>
              絞り込みを解除
            </button>
          </div>
        )
      ) : (
        <>
          <ul className={styles.list}>
            {rows.map((h) => {
              const dots = recentDots(h.recent, today);
              const { done, total } = dotCounts(dots);
              return (
                <li
                  key={h.id}
                  className={`${styles.row} ${h.active ? "" : own.paused}`}
                  data-focused={current?.id === h.id ? "" : undefined}
                  onClick={() => setSel(h.id)}
                >
                  <div className={styles.body}>
                    <div className={styles.title}>
                      {h.title}
                      {!h.active && <span className={own.tag}>一時停止中</span>}
                    </div>
                    <div className={styles.meta}>
                      <span>
                        {habitRuleText(h)} · {slotName(h.time_slot)}
                      </span>
                      {projectName(h.project_id) && (
                        <span>{projectName(h.project_id)}</span>
                      )}
                      <span>
                        直近7回 {done}/{total}
                      </span>
                    </div>
                    <div className={extra.dots} aria-hidden="true">
                      {dots.map((x, i) => (
                        <i key={i} data-state={x} title={DOT_TITLE[x]} />
                      ))}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {add}
        </>
      )}

      <HabitSheetHost
        key={sel === "new" ? "new" : (current?.id ?? "none")}
        open={sel === "new" || current != null}
        showEmpty
        mode={sel === "new" ? "new" : "edit"}
        habit={current}
        seed={seed}
        onChanged={replace}
        onCreated={(created) => {
          setHabits((hs) => [...hs, created]);
          setSel(created.id);
          refreshCounts();
          showToast({ msg: `習慣「${created.title}」を作成しました` });
        }}
        onDeleted={() => {
          const title = current?.title ?? "";
          setHabits((hs) => hs.filter((h) => h.id !== current?.id));
          setSel(null);
          refreshCounts();
          showToast({ msg: `習慣「${title}」を削除しました` });
        }}
        onClose={() => {
          setSel(null);
          void fetchAll(false);
        }}
      />
    </>
  );
}
