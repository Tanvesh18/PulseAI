import { notFound } from "next/navigation";
import { PortalShell } from "@/features/portal/portal-shell";
import { PortalScreen } from "@/features/portal/portal-screen";
import {
  DirectorPortalScreen,
  type DirectorSection,
} from "@/features/director/director-portal-screen";
import { workspaceFocus } from "@/config/workspace-focus";

export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (
    ![
      "dashboard",
      "timesheets",
      "approvals",
      "reports",
      "notifications",
      "audit",
    ].includes(section)
  )
    notFound();
  const screen = section === "dashboard" ? "overview" : section;
  return (
    <PortalShell>
      {workspaceFocus === "DIRECTOR" ? (
        <DirectorPortalScreen section={screen as DirectorSection} />
      ) : (
        <PortalScreen section={screen} />
      )}
    </PortalShell>
  );
}
