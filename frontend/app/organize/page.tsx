import { redirect } from "next/navigation";
import { DEFAULT_ORGANIZE_SCREEN } from "@/lib/organize";

export default function OrganizePage() {
  redirect(`/organize/${DEFAULT_ORGANIZE_SCREEN}`);
}
