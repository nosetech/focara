/**
 * 詳細の保存完了通知を1回にまとめる(デバウンス)。
 * `notify()` を連続で呼ぶと、最後の呼び出しから `wait` ms 後に `fn` を1回だけ呼ぶ。
 * `flushNow()` は待たずに即実行し、保留中の呼び出しを取り消す。
 */
export function createCoalescer(fn: () => void, wait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    notify() {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, wait);
    },
    flushNow() {
      cancel();
      fn();
    },
    cancel,
  };
}
