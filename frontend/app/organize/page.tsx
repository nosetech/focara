import { EmptyState } from "@/components/StateView";

export default function OrganizePage() {
  return (
    <EmptyState
      title="整理画面は準備中です"
      description="inboxの整理はこの画面で行えるようになります。"
      href="/"
      actionLabel="実行画面へ戻る"
    />
  );
}
