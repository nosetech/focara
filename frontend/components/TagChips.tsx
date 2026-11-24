import styles from "./TagChips.module.css";

/**
 * プロジェクトのタグの表示。max を超える分は「+N」にまとめる。タグがなければ何も出さない。
 * size: run-sm / run-md は実行画面(モバイル / デスクトップ)、row は一覧の行、header は詳細ヘッダー。
 */
export function TagChips({
  tags,
  max,
  size,
  active = [],
  onSurface = false,
}: {
  tags: readonly string[];
  max?: number;
  size: "run-sm" | "run-md" | "row" | "header";
  /** 絞り込みに使っているタグ(row のみ。文字を濃くする) */
  active?: readonly string[];
  /** 選択中の行など、地が --sunk のとき true(チップの地を --surface にする) */
  onSurface?: boolean;
}) {
  if (tags.length === 0) return null;
  const shown = max == null ? tags : tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span
      className={styles.tags}
      data-size={size}
      data-surface={onSurface ? "" : undefined}
      title={`タグ: ${tags.join("、")}`}
    >
      {shown.map((t) => (
        <span
          key={t}
          className={styles.tag}
          data-active={active.includes(t) ? "" : undefined}
        >
          {t}
        </span>
      ))}
      {rest > 0 && <span className={styles.more}>+{rest}</span>}
    </span>
  );
}
