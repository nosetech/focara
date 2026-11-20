import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Zen_Kaku_Gothic_New } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const zenKaku = Zen_Kaku_Gothic_New({
  variable: "--font-sans",
  weight: ["400", "500", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Focara",
  description: "Focara(フォカラ)",
  appleWebApp: { capable: true, title: "Focara", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${zenKaku.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* favicon.ico / icon.svg は app/ 直下のファイルから自動で出力される。
            apple-touch-icon は next dev では出さない: dev サーバーで apple-touch-icon があると
            Android 版 Chrome のタブで favicon が一瞬表示されたあと消える(next start では問題ない)。
            metadata.icons で指定すると icon.svg が出力されなくなるので、ここで直接書く。 */}
        {process.env.NODE_ENV === "production" && (
          <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        )}
      </head>
      <body>
        <ServiceWorkerRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
