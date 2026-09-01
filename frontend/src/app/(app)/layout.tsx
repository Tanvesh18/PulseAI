import type { ReactNode } from "react";

type AuthenticatedApplicationLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function AuthenticatedApplicationLayout({
  children,
}: AuthenticatedApplicationLayoutProps) {
  return children;
}
