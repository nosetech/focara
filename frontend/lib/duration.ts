/** 時間(継続時間)プロパティの変換。APIは秒数の整数文字列、画面は HH:MM:SS。 */

const HMS = /^(\d+):([0-5]\d):([0-5]\d)$/;
// 入力途中の補完: MM:SS(分:秒)も受け付ける
const MS = /^([0-5]?\d):([0-5]\d)$/;

/** HH:MM:SS(時は2桁以上も可)を秒に変換する。MM:SS も受け付ける。不正なら null。 */
export function parseDuration(text: string): number | null {
  const s = text.trim();
  const hms = HMS.exec(s);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  const ms = MS.exec(s);
  if (ms) return Number(ms[1]) * 60 + Number(ms[2]);
  return null;
}

/** 秒数(整数文字列)を HH:MM:SS に整形する。空・不正はそのまま空文字。 */
export function formatDuration(seconds: string | null | undefined): string {
  if (seconds == null || !/^\d+$/.test(seconds.trim())) return "";
  const total = Number(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(s)}`;
}
