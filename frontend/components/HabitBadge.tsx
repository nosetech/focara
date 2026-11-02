import styles from "./HabitBadge.module.css";

const ICON = (size: number, stroke: number) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />
  </svg>
);

/** 習慣から生成された子タスクの印。icon は枠の狭い場所(週カレンダー・一覧)用のアイコンのみ表示。 */
export function HabitBadge({ icon = false }: { icon?: boolean }) {
  return icon ? (
    <span
      className={styles.icon}
      role="img"
      aria-label="習慣から生成"
      title="習慣から生成"
    >
      {ICON(10, 2.4)}
    </span>
  ) : (
    <span className={styles.pill} title="習慣から生成">
      {ICON(10, 2.2)}
      習慣
    </span>
  );
}
