import styles from "./OrganizeStates.module.css";

const SKELETON_WIDTHS = [100, 92, 96, 84, 90, 70];

export function OrganizeEmpty({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className={styles.message}>
      <div className={styles.title}>{title}</div>
      <div className={styles.text}>{text}</div>
    </div>
  );
}

export function OrganizeLoading() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="読み込み中">
      {SKELETON_WIDTHS.map((w) => (
        <i key={w} style={{ width: `${w}%` }} />
      ))}
    </div>
  );
}

export function OrganizeError({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.message} role="alert">
      <div className={styles.title}>{label}を読み込めませんでした</div>
      <div className={styles.text}>
        通信が不安定な可能性があります。接続を確認して、もう一度お試しください。
      </div>
      <button className={styles.retry} onClick={onRetry}>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
        </svg>
        再試行
      </button>
    </div>
  );
}
