import type { NextConfig } from "next";

// LAN/Tailscale上の別端末から開発サーバへアクセスするときのホスト名(カンマ区切り)。
// 許可しないと /_next/* が403になりJSが動かない(テーマ切替などが効かない)。
const allowedDevOrigins = (process.env.FRONTEND_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // 配布用に standalone 出力する(.next/standalone/server.js で起動できる)。
  output: "standalone",
  allowedDevOrigins,
};

export default nextConfig;
