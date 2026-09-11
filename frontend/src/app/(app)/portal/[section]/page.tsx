import { PortalScreen } from "@/features/portal/portal-screen";
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  return <PortalScreen section={section} />;
}
