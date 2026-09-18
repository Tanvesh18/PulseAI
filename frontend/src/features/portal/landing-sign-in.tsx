"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Building2,
  ShieldCheck,
  Upload,
  LockKeyhole,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import type { Role } from "./types";
import styles from "./portal.module.css";
import { isWorkspaceEnabled } from "@/config/workspace-focus";

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
  const [selectedRole, setSelectedRole] = useState<Role>("DIRECTOR");
  const [sessionStatus, setSessionStatus] = useState<
    "loading" | "demo" | "organization" | "error"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/demo-session")
      .then((response) => {
        if (!response.ok)
          throw new Error("Unable to check sign-in availability.");
        return response.json() as Promise<{ enabled: boolean }>;
      })
      .then((result) =>
        setSessionStatus(result.enabled ? "demo" : "organization"),
      )
      .catch(() => setSessionStatus("error"));
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
      router.push(`/login?role=${selectedRole}`);
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
          description="Choose your role, then sign in with your organization account. Only Director is available right now."
        />
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
              disabled={busy || !isWorkspaceEnabled(value)}
              onClick={() => setSelectedRole(value)}
            >
              <span className={styles.roleIcon} aria-hidden="true">
                {isWorkspaceEnabled(value) ? (
                  <Icon size={22} />
                ) : (
                  <LockKeyhole size={22} />
                )}
              </span>
              <span>
                <strong>{label}</strong>
                <small>
                  {isWorkspaceEnabled(value)
                    ? description
                    : "Under maintenance"}
                </small>
              </span>
            </button>
          ))}
        </div>
        <Button
          className={styles.landingAction}
          disabled={busy || sessionStatus !== "demo"}
          onClick={() => void signIn()}
        >
          {busy
            ? "Continuing..."
            : sessionStatus === "loading"
              ? "Checking sign-in..."
              : sessionStatus === "demo"
                ? "Continue to sign in"
                : "Organization sign-in required"}
        </Button>
        {sessionStatus === "demo" ? (
          <p className={styles.muted}>
            Demo environment: choose an identity provider on the next screen.
          </p>
        ) : sessionStatus === "organization" ? (
          <Alert title="Organization sign-in required" tone="info">
            Demo sign-in is disabled in this environment. Sign in through your
            organization&apos;s identity provider.
          </Alert>
        ) : sessionStatus === "error" ? (
          <Alert title="Unable to check sign-in" tone="error">
            Refresh the page to try again.
          </Alert>
        ) : null}
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
