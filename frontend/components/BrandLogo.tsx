export function BrandLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <rect
        x="0.75"
        y="0.75"
        width="98.5"
        height="98.5"
        rx="22.5"
        fill="var(--surface)"
        stroke="var(--line)"
        strokeWidth="1.5"
      />
      <path
        d="M36 74V27h32"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="58" cy="50" r="8" fill="var(--accent)" />
    </svg>
  );
}
