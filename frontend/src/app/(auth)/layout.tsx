import type { ReactNode } from "react";

type AuthenticationLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function AuthenticationLayout({
  children,
}: AuthenticationLayoutProps) {
  return children;
}
