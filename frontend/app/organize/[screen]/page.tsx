import { notFound } from "next/navigation";
import { AssignScreen } from "@/components/AssignScreen";
import { CalendarScreen } from "@/components/CalendarScreen";
import { InboxScreen } from "@/components/InboxScreen";
import { ProjectsScreen } from "@/components/ProjectsScreen";
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
  if (screen === "inbox") return <InboxScreen />;
  if (screen === "assign") return <AssignScreen />;
  if (screen === "projects") return <ProjectsScreen />;
  if (screen === "day" || screen === "week")
    return <CalendarScreen mode={screen} />;
  const label = ORGANIZE_SCREENS.find((s) => s.key === screen)?.label;
  return (
    <OrganizeEmpty
      title={`${label}は準備中です`}
      text="この画面の中身は順次実装されます。"
    />
  );
}
