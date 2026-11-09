"use client";

/** メニュー下部の「折りたたむ / 常に表示する」トグル(PC幅のみ表示は呼び出し側のCSSで制御)。 */
export function SidebarToggle({
  collapsed,
  onToggle,
  className,
  labelClassName,
}: {
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  labelClassName?: string;
}) {
  const label = collapsed ? "常に表示する" : "折りたたむ";
  return (
    <button
      type="button"
      className={className}
      title={label}
      aria-label={label}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: "none" }}
      >
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path
          d={
            collapsed
              ? "M9 4.5v15M13.5 10l2 2-2 2"
              : "M9 4.5v15M15.5 10l-2 2 2 2"
          }
        />
      </svg>
      <span className={labelClassName}>{label}</span>
    </button>
  );
}
