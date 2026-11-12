"use client";

import { assignableProjects } from "@/lib/projects";
import { createPortal } from "react-dom";
import { HabitSheet, type HabitSheetProps } from "./HabitSheet";
import { useOrganize } from "./OrganizeContext";
import { useIsDesktop } from "./TaskDetailHost";
import styles from "./OrganizeShell.module.css";

/**
 * 習慣の作成・編集シートを出す。デスクトップは右ペイン(panel)、モバイルは画面下のシート。
 * `open` が false のときは何も出さない(`showEmpty` ならデスクトップの右ペインに案内を出す)。
 */
export function HabitSheetHost({
  open,
  showEmpty = false,
  ...props
}: Omit<HabitSheetProps, "variant" | "projects"> & {
  open: boolean;
  showEmpty?: boolean;
}) {
  const { panelEl, projects } = useOrganize();
  const desktop = useIsDesktop();

  const sheet = open ? (
    <HabitSheet
      {...props}
      variant={desktop ? "panel" : "sheet"}
      projects={assignableProjects(
        projects,
        props.habit?.project_id ?? props.seed?.projectId,
      )}
    />
  ) : null;

  if (!desktop) return sheet;
  if (!panelEl) return null;
  const content =
    sheet ??
    (showEmpty ? (
      <div className={styles.panelEmpty}>
        習慣を選ぶと
        <br />
        ここで編集できます
      </div>
    ) : null);
  return content && createPortal(content, panelEl);
}
