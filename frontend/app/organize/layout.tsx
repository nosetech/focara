import { OrganizeFrame } from "@/components/OrganizeFrame";

export default function OrganizeLayout({ children }: LayoutProps<"/organize">) {
  return <OrganizeFrame>{children}</OrganizeFrame>;
}
