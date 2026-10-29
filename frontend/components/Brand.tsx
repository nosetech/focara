"use client";

import { useEffect, useState } from "react";
import { fetchAppVersion } from "@/lib/api";
import { BrandLogo } from "./BrandLogo";

/** サイドバー先頭のロゴ・アプリ名と、その右のバージョン表示。 */
export function Brand({
  className,
  versionClassName,
}: {
  className: string;
  versionClassName: string;
}) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchAppVersion().then((v) => {
      if (alive) setVersion(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={className}>
      <BrandLogo />
      Focara
      {version && <span className={versionClassName}>v{version}</span>}
    </div>
  );
}
