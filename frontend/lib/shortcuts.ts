/** 画面切り替えのショートカットキー(小文字で持つ)。 */
export const NAV_SHORTCUTS = [
  { key: "r", href: "/", label: "実行画面" },
  { key: "i", href: "/organize/inbox", label: "inbox" },
  { key: "a", href: "/organize/assign", label: "3枠割り当て" },
] as const;

/** href に対応するショートカットキー(大文字表示)。無ければ undefined。 */
export function shortcutKeyFor(href: string): string | undefined {
  return NAV_SHORTCUTS.find((s) => s.href === href)?.key.toUpperCase();
}

export type ShortcutEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  targetInInput: boolean;
};

/**
 * キー押下から移動先を決める。移動しない場合は null。
 * 修飾キー(Shift 単独は可)・IME 変換中・入力欄・ダイアログ表示中・現在地と同じ移動先は無視する。
 */
export function resolveNavShortcut(
  e: ShortcutEvent,
  pathname: string,
  dialogOpen: boolean,
): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return null;
  if (e.targetInInput || dialogOpen) return null;
  const hit = NAV_SHORTCUTS.find((s) => s.key === e.key.toLowerCase());
  if (!hit || hit.href === pathname) return null;
  return hit.href;
}
