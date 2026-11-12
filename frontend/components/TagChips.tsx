import styles from "./TagChips.module.css";

/** プロジェクトのタグの表示。max を超える分は「+N」にまとめる。タグがなければ何も出さない。 */
export function TagChips({
  tags,
  max,
  size = "md",
}: {
  tags: readonly string[];
  max?: number;
  size?: "sm" | "md";
}) {
  if (tags.length === 0) return null;
  const shown = max == null ? tags : tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={styles.tags} data-size={size} title={tags.join("、")}>
      {shown.map((t) => (
        <span key={t} className={styles.tag}>
          {t}
        </span>
      ))}
      {rest > 0 && <span className={styles.more}>+{rest}</span>}
    </span>
  );
}
