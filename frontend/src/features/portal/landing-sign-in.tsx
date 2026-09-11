"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Building2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/features/employee/components/page-header";
import type { Role } from "./types";
import styles from "./portal.module.css";

const roles: ReadonlyArray<{
  value: Role;
  label: string;
  description: string;
  icon: typeof BriefcaseBusiness;
}> = [
  {
    value: "MANAGER",
    label: "Timesheet Manager",
    description: "Update and submit team timesheets",
    icon: BriefcaseBusiness,
  },
  {
    value: "FINANCE",
    label: "Finance Team",
    description: "Manage reference data, approvals, and exports",
    icon: Building2,
  },
  {
    value: "HR",
    label: "HR",
    description: "Upload employee data and generate cycles",
    icon: Upload,
  },
  {
    value: "DIRECTOR",
    label: "Director",
    description: "Review and approve submitted timesheets",
    icon: ShieldCheck,
  },
];

export function LandingSignIn() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<Role>("MANAGER");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/demo-session")
      .then((response) => response.json() as Promise<{ enabled: boolean }>)
      .then((result) => setDemoEnabled(result.enabled))
      .catch(() => setDemoEnabled(false));
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: selectedRole }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message ?? "Sign-in failed.");
      router.push("/portal");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.landing}>
      <div className={styles.landingMark} aria-hidden="true">
        <span>Pulse</span> AI
      </div>
      <div className={styles.landingPanel}>
        <PageHeader
          title="Timesheet Automation Portal"
          description="Choose your workspace to continue."
        />
        {demoEnabled ? (
          <>
            <div
              className={styles.roleGrid}
              role="group"
              aria-label="Choose a workspace"
            >
              {roles.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  className={`${styles.roleCard} ${selectedRole === value ? styles.roleCardSelected : ""}`}
                  aria-pressed={selectedRole === value}
                  onClick={() => setSelectedRole(value)}
                >
                  <span className={styles.roleIcon} aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </span>
                </button>
              ))}
            </div>
            <Button
              className={styles.landingAction}
              disabled={busy}
              onClick={() => void signIn()}
            >
              {busy ? "Signing in..." : "Sign in to demo portal"}
            </Button>
            <p className={styles.muted}>
              Demo environment - Changes are saved to PostgreSQL.
            </p>
          </>
        ) : (
          <Alert title="Organization sign-in required" tone="info">
            Demo role selection is disabled in production. Sign in through your
            organization&apos;s identity provider.
          </Alert>
        )}
        {error ? (
          <Alert title="Sign-in failed" tone="error">
            {error}
          </Alert>
        ) : null}
      </div>
      <p className={styles.landingFooter}>
        Emerson - Enterprise IT - India CoE
      </p>
    </main>
  );
}
