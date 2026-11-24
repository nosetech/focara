import type { MetadataRoute } from "next";

// アイコンは本番ビルドのときだけ出す。next dev で manifest に icons があると、
// Android 版 Chrome でリロードのたびに favicon が消える(next start では問題ない)。
const icons: MetadataRoute.Manifest["icons"] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Focara",
    short_name: "Focara",
    description: "Focara(フォカラ)",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    lang: "ja",
    background_color: "#f4f3ef",
    theme_color: "#f4f3ef",
    icons: process.env.NODE_ENV === "production" ? icons : undefined,
  };
}
