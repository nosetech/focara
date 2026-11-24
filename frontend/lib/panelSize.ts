/** タスク詳細の幅の既定値(px)。整理画面の右ペインとシートで共通。 */
export const DETAIL_DEFAULT_WIDTH = 400;
/** タスク詳細の幅の下限(px)。 */
export const DETAIL_MIN_WIDTH = 320;
/** タスク詳細の幅の上限(ウィンドウ幅に対する割合)。 */
export const DETAIL_MAX_RATIO = 0.6;
/** キーボード(左右矢印)での幅変更の刻み(px)。 */
export const DETAIL_KEY_STEP = 16;

export const DETAIL_STORAGE_KEY = "focara:detailPanel";
export const SIDEBAR_STORAGE_KEY = "focara:sidebar";

/** 折りたたみ中のメニューの幅(px)。 */
export const SIDEBAR_COLLAPSED_WIDTH = 68;

/** ウィンドウ幅から、タスク詳細の幅の上限を返す。下限を下回らない。 */
export function detailMaxWidth(viewport: number): number {
  return Math.max(DETAIL_MIN_WIDTH, Math.floor(viewport * DETAIL_MAX_RATIO));
}

/** 幅を、下限〜上限の範囲に収める。数値でなければ既定値。 */
export function clampDetailWidth(width: number, viewport: number): number {
  if (!Number.isFinite(width)) return DETAIL_DEFAULT_WIDTH;
  const max = detailMaxWidth(viewport);
  return Math.min(max, Math.max(DETAIL_MIN_WIDTH, Math.round(width)));
}

/**
 * ドラッグ開始時の幅とポインターの移動量から、新しい幅を返す。
 * ハンドルは詳細の左端にあるので、左へ動かす(dx < 0)と広がる。
 */
export function widthFromDrag(
  startWidth: number,
  dx: number,
  viewport: number,
): number {
  return clampDetailWidth(startWidth - dx, viewport);
}

/** 保存値(文字列)を検証して幅を返す。未保存・壊れた値・範囲外は null。 */
export function parseDetailWidth(
  raw: string | null,
  viewport: number,
): number | null {
  if (raw == null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < DETAIL_MIN_WIDTH || value > detailMaxWidth(viewport)) return null;
  return Math.round(value);
}

/** 保存値(文字列)を検証してメニューの折りたたみ状態を返す。壊れた値は false(展開)。 */
export function parseSidebarCollapsed(raw: string | null): boolean {
  if (raw == null) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "collapsed" in value) {
      return (value as { collapsed: unknown }).collapsed === true;
    }
  } catch {
    // 壊れた値は既定(展開)に戻す
  }
  return false;
}

export function serializeSidebar(collapsed: boolean): string {
  return JSON.stringify({ collapsed });
}
