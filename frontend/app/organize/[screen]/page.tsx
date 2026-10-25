import { notFound } from "next/navigation";
import { OrganizeEmpty } from "@/components/OrganizeStates";
import { ORGANIZE_SCREENS, isOrganizeScreen } from "@/lib/organize";

export function generateStaticParams() {
  return ORGANIZE_SCREENS.map((s) => ({ screen: s.key }));
}

export default async function OrganizeScreenPage({
  params,
}: PageProps<"/organize/[screen]">) {
  const { screen } = await params;
  if (!isOrganizeScreen(screen)) notFound();
  const label = ORGANIZE_SCREENS.find((s) => s.key === screen)?.label;
  return (
    <OrganizeEmpty
      title={`${label}は準備中です`}
      text="この画面の中身は順次実装されます。"
    />
  );
}
