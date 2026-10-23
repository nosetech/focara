import Link from "next/link";
import styles from "./StateView.module.css";

/** 空状態。見出しと説明、任意で行き先へのリンクを出す。 */
export function EmptyState({
  title,
  description,
  href,
  actionLabel,
}: {
  title: string;
  description: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className={styles.message}>
      <h1>{title}</h1>
      <p>{description}</p>
      {href && actionLabel && (
        <Link href={href} className={styles.action}>
          {actionLabel}
        </Link>
      )}
    </div>
  );
}

/** 読み込み失敗。再試行ボタンを出す。 */
export function ErrorState({
  title,
  onRetry,
}: {
  title: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.message} role="alert">
      <h1>{title}</h1>
      <p>
        通信が不安定な可能性があります。接続を確認して、もう一度お試しください。
      </p>
      <button className={styles.action} onClick={onRetry}>
        再試行
      </button>
    </div>
  );
}

/** 読み込み中のスケルトン。 */
export function LoadingState() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="読み込み中">
      <i style={{ height: 3, width: "100%" }} />
      <i style={{ height: 12, width: 110, marginTop: 52 }} />
      <i style={{ height: 28, width: 300, marginTop: 16 }} />
      <i style={{ height: 28, width: 190, marginTop: 12 }} />
      <i style={{ height: 26, width: 120, marginTop: 22, borderRadius: 999 }} />
      <i style={{ height: 14, width: 240, marginTop: 64 }} />
      <i style={{ height: 14, width: 200, marginTop: 22 }} />
    </div>
  );
}
