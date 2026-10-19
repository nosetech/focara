export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "focara-theme";

const listeners = new Set<() => void>();

function systemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 手動で選ばれたテーマ。未選択ならnull(OS設定に追従)。 */
export function getStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** 実際に適用されているテーマ(手動選択 > OS設定)。 */
export function getResolvedTheme(): ThemeMode {
  return getStoredTheme() ?? systemTheme();
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // 保存できなくてもセッション中の切替は有効にする
  }
  document.documentElement.dataset.theme = mode;
  listeners.forEach((l) => l());
}

export function subscribeTheme(onChange: () => void): () => void {
  listeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onChange);
  };
}

/** 初回描画前に data-theme を適用してちらつきを防ぐインラインスクリプト。 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})()`;
