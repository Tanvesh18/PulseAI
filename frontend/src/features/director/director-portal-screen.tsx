"use client";

import { PortalScreen } from "@/features/portal/portal-screen";
import { directorSections } from "./director-sections";

export type DirectorSection = (typeof directorSections)[number];

export function DirectorPortalScreen({
  section,
}: {
  section: DirectorSection;
}) {
  return <PortalScreen section={section} />;
}
