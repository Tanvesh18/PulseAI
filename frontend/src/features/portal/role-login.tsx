"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Building2, Globe2, LockKeyhole, Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { isWorkspaceEnabled } from "@/config/workspace-focus";
import type { Role } from "./types";
import styles from "./portal.module.css";

const validRoles: Role[] = ["MANAGER", "FINANCE", "HR", "DIRECTOR"];
const roleLabels: Record<Role, string> = {
  MANAGER: "Timesheet Manager",
  FINANCE: "Finance Team",
  HR: "HR",
  DIRECTOR: "Director",
};

type Provider = "Google" | "Outlook" | "Gmail";

export function RoleLogin() {
  const params = useSearchParams();
  const router = useRouter();
  const requestedRole = params.get("role");
  const role = validRoles.find((value) => value === requestedRole);
  const [sessionStatus, setSessionStatus] = useState<
    "loading" | "demo" | "organization" | "error"
  >("loading");
  const [busy, setBusy] = useState<Provider | null>(null);
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

  async function signIn(provider: Provider) {
    if (!role) return;
    setBusy(provider);
    setError(null);
    try {
      const response = await fetch("/api/demo-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!response.ok) throw new Error(payload?.message ?? "Sign-in failed.");
      router.push("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!role || !isWorkspaceEnabled(role)) {
    return (
      <main className={styles.landing} id="main-content">
        <div className={styles.landingPanel}>
          <Alert title="Workspace unavailable" tone="error">
            Choose an available workspace before signing in.
          </Alert>
          <Link href="/">Return to role selection</Link>
        </div>
      </main>
    );
  }

  const disabled = sessionStatus !== "demo" || Boolean(busy);
  return (
    <main className={styles.landing} id="main-content">
      <div className={styles.landingMark} aria-hidden="true">
        <span>Pulse</span> AI
      </div>
      <section className={styles.landingPanel} aria-labelledby="login-title">
        <Link href="/" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" /> Change role
        </Link>
        <PageHeader
          title="Sign in to Pulse AI"
          description={`Continue to the ${roleLabels[role]} workspace with your organization account.`}
        />
        <div className={styles.identityNotice}>
          <LockKeyhole size={20} aria-hidden="true" />
          <p>
            Your identity and access are verified by your chosen provider. Your
            role determines which workspace data you can access.
          </p>
        </div>
        <div
          className={styles.providerList}
          aria-label="Choose a sign-in provider"
        >
          <Button
            variant="secondary"
            className={styles.providerButton}
            disabled={disabled}
            onClick={() => void signIn("Google")}
          >
            <Globe2 size={20} aria-hidden="true" />
            {busy === "Google" ? "Signing in..." : "Continue with Google"}
          </Button>
          <Button
            variant="secondary"
            className={styles.providerButton}
            disabled={disabled}
            onClick={() => void signIn("Outlook")}
          >
            <Building2 size={20} aria-hidden="true" />
            {busy === "Outlook"
              ? "Signing in..."
              : "Continue with Microsoft Outlook"}
          </Button>
          <Button
            variant="secondary"
            className={styles.providerButton}
            disabled={disabled}
            onClick={() => void signIn("Gmail")}
          >
            <Mail size={20} aria-hidden="true" />
            {busy === "Gmail" ? "Signing in..." : "Continue with Gmail"}
          </Button>
        </div>
        {sessionStatus === "loading" && (
          <p className={styles.muted}>Checking sign-in...</p>
        )}
        {sessionStatus === "demo" && (
          <Alert title="Demo sign-in" tone="info">
            Provider buttons open the seeded Director account locally. In a
            deployed environment, they must be connected to the
            organization&apos;s Google or Microsoft identity provider.
          </Alert>
        )}
        {sessionStatus === "organization" && (
          <Alert title="Organization sign-in required" tone="info">
            Identity-provider sign-in has not yet been configured for this
            deployment.
          </Alert>
        )}
        {sessionStatus === "error" && (
          <Alert title="Unable to check sign-in" tone="error">
            Refresh the page to try again.
          </Alert>
        )}
        {error && (
          <Alert title="Sign-in failed" tone="error">
            {error}
          </Alert>
        )}
      </section>
      <p className={styles.landingFooter}>
        Emerson - Enterprise IT - India CoE
      </p>
    </main>
  );
}
