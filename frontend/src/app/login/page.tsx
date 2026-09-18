import { Suspense } from "react";
import { RoleLogin } from "@/features/portal/role-login";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <RoleLogin />
    </Suspense>
  );
}
