"use client";

import { useEffect, useState } from "react";
import { fetchAppVersion } from "@/lib/api";
import { BrandLogo } from "./BrandLogo";

/** サイドバー先頭のロゴ・アプリ名と、その下のバージョン表示。 */
export function Brand({
  className,
  nameClassName,
  versionClassName,
}: {
  className: string;
  nameClassName: string;
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
      <span className={nameClassName}>
        <BrandLogo />
        Focara
      </span>
      {version && <span className={versionClassName}>v{version}</span>}
    </div>
  );
}
