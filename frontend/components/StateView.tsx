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

/**
 * 読み込み中のスケルトン。Focara 実行画面.dc.html の「読み込み中」に合わせる
 * (モバイルは上部の進捗バー付き、デスクトップは大きい見出しとボタンの形)。
 * プロジェクト名の右にはタグの仮表示を出す。
 */
export function LoadingState() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="読み込み中">
      <div className={styles.skelMobile}>
        <i className={styles.sBar} />
        <i className={styles.sLabelM} />
        <div className={styles.sProjectM}>
          <i style={{ width: 72 }} />
          <i style={{ width: 36, opacity: 0.7 }} />
          <i style={{ width: 28, opacity: 0.7 }} />
        </div>
        <i className={styles.sTitleM1} />
        <i className={styles.sTitleM2} />
        <div className={styles.sChipsM}>
          <i style={{ width: 56 }} />
          <i style={{ width: 72 }} />
          <i style={{ width: 48 }} />
        </div>
        <i className={styles.sLabelM2} />
        <div className={styles.sLinesM}>
          <i style={{ width: 240 }} />
          <i style={{ width: 200 }} />
          <i style={{ width: 260 }} />
        </div>
      </div>
      <div className={styles.skelDesktop}>
        <i className={styles.sLabelD} />
        <div className={styles.sProjectD}>
          <i style={{ width: 84 }} />
          <i style={{ width: 44, opacity: 0.7 }} />
          <i style={{ width: 36, opacity: 0.7 }} />
        </div>
        <i className={styles.sTitleD1} />
        <i className={styles.sTitleD2} />
        <div className={styles.sChipsD}>
          <i style={{ width: 64 }} />
          <i style={{ width: 84 }} />
          <i style={{ width: 56 }} />
        </div>
        <div className={styles.sButtonsD}>
          <i style={{ width: 150 }} />
          <i style={{ width: 120 }} />
        </div>
      </div>
    </div>
  );
}
