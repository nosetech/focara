"use client";

import { usePathname } from "next/navigation";
import { OrganizeError } from "@/components/OrganizeStates";
import { ORGANIZE_SCREENS } from "@/lib/organize";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const pathname = usePathname();
  const label =
    ORGANIZE_SCREENS.find((s) => pathname === `/organize/${s.key}`)?.label ??
    "整理画面";
  return <OrganizeError label={label} onRetry={reset} />;
}
