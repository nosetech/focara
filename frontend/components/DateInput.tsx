import styles from "./DateInput.module.css";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 日付入力に付けるクラス(親の行レイアウトに合わせる) */
  inputClassName?: string;
  "aria-label": string;
}

/**
 * 日付入力と「クリア」ボタン。ブラウザ標準の日付入力は空に戻せないため、
 * 値があるときだけクリアボタンを隣に出す。親のflex行に直接並べる(Fragment)。
 */
export function DateInput({
  value,
  onChange,
  inputClassName,
  "aria-label": ariaLabel,
}: Props) {
  return (
    <>
      <input
        type="date"
        className={inputClassName}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          aria-label="日付をクリア"
          onClick={() => onChange("")}
        >
          クリア
        </button>
      )}
    </>
  );
}
