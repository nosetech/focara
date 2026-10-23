import styles from "./Toast.module.css";

export interface ToastMessage {
  msg: string;
  undo?: () => void;
}

/** 画面下部に出る共通トースト。表示/非表示は呼び出し側が toast の有無で切り替える。 */
export function Toast({ toast }: { toast: ToastMessage | null }) {
  return (
    <div
      className={styles.toast}
      data-show={toast ? "" : undefined}
      role="status"
      aria-live="polite"
    >
      <span>{toast?.msg}</span>
      {toast?.undo && (
        <button onClick={toast.undo} className={styles.toastUndo}>
          元に戻す
        </button>
      )}
    </div>
  );
}
