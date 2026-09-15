"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  CalendarDays,
  CheckCheck,
  Database,
  FileBarChart,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Upload,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { api } from "./api";
import type { Session } from "./types";
import { roleSections, type PortalSection } from "@/features/roles/sections";
import shell from "@/components/shell/app-shell.module.css";
import styles from "./portal.module.css";
import { isWorkspaceEnabled } from "@/config/workspace-focus";

type Context = {
  session: Session;
  period: string;
  setPeriod: (value: string) => void;
  refresh: number;
  busy: boolean;
  execute: (
    action: () => Promise<unknown>,
    success?: string,
  ) => Promise<boolean>;
};
const PortalContext = createContext<Context | null>(null);
export function usePortal() {
  const context = useContext(PortalContext);
  if (!context) throw new Error("Portal context is missing.");
  return context;
}
export const navItems = [
  {
    path: "",
    label: "Overview",
    icon: LayoutDashboard,
    roles: ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
  },
  {
    path: "/timesheets",
    label: "Team timesheets",
    icon: CalendarDays,
    roles: ["MANAGER", "FINANCE", "DIRECTOR"],
  },
  {
    path: "/approvals",
    label: "Approvals",
    icon: CheckCheck,
    roles: ["FINANCE", "DIRECTOR"],
  },
  {
    path: "/reports",
    label: "Reports",
    icon: FileBarChart,
    roles: ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
  },
  {
    path: "/masters",
    label: "Master data",
    icon: Database,
    roles: ["FINANCE"],
  },
  {
    path: "/access",
    label: "User access",
    icon: ShieldCheck,
    roles: ["FINANCE"],
  },
  {
    path: "/imports",
    label: "HR data upload",
    icon: Upload,
    roles: ["HR", "FINANCE"],
  },
  {
    path: "/notifications",
    label: "Notifications",
    icon: Bell,
    roles: ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
  },
  {
    path: "/audit",
    label: "Audit history",
    icon: History,
    roles: ["MANAGER", "FINANCE", "HR", "DIRECTOR"],
  },
];

function sectionForPath(path: string): PortalSection {
  return (path ? path.slice(1) : "overview") as PortalSection;
}
export function PortalShell({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [period, setPeriod] = useState(() =>
    new Date().toISOString().slice(0, 7),
  );
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    let active = true;
    async function connect() {
      try {
        const next = await api<Session>("session");
        if (active) setSession(next);
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not connect to the workspace.",
          );
          setSession(null);
        }
      }
    }
    void connect();
    return () => {
      active = false;
    };
  }, []);
  const execute = useCallback(
    async (action: () => Promise<unknown>, success = "Changes saved.") => {
      setBusy(true);
      setMessage("");
      setError("");
      try {
        await action();
        setMessage(success);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "The request failed.");
        return false;
      } finally {
        setRefresh((v) => v + 1);
        setBusy(false);
      }
    },
    [],
  );
  const navigation = (
    <nav className={shell.navigation} aria-label="Team workspace navigation">
      <p className={shell.navigationLabel}>Workspace</p>
      <ul>
        {navItems
          .filter(
            (item) =>
              session &&
              roleSections[session.role].includes(sectionForPath(item.path)),
          )
          .map((item) => (
            <li key={item.path}>
              <Link
                onClick={() => setOpen(false)}
                href={(item.path || "/dashboard") as Route}
                className={`${shell.navigationLink} ${pathname === (item.path || "/dashboard") ? shell.navigationLinkActive : ""}`}
                aria-current={
                  pathname === (item.path || "/dashboard") ? "page" : undefined
                }
              >
                <item.icon size={20} aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          ))}
        {isWorkspaceEnabled("EMPLOYEE") && (
          <li>
            <Link className={shell.navigationLink} href="/employee">
              <CalendarDays size={20} aria-hidden="true" />
              Employee workspace
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
  const identity = (
    <Link href={"/dashboard" as Route} className={shell.productIdentity}>
      <span className={shell.productMark}>
        <Activity size={22} aria-hidden="true" />
      </span>
      <span>Pulse AI</span>
    </Link>
  );
  const profile = session && (
    <div className={shell.profileSummary}>
      <span className={shell.avatar} aria-hidden="true">
        {session.name
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")}
      </span>
      <span className={shell.profileCopy}>
        <strong>{session.name}</strong>
        <span>{session.role.toLowerCase()}</span>
      </span>
    </div>
  );
  const current = navItems.find(
    (item) => (item.path || "/dashboard") === pathname,
  );
  return (
    <div className={shell.shell}>
      <aside className={shell.sidebar}>
        {identity}
        {navigation}
        {profile}
      </aside>
      <div className={shell.workspace}>
        <header className={shell.topHeader}>
          <div className={shell.headerIdentity}>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <button
                  className={shell.mobileMenuTrigger}
                  aria-label="Open navigation"
                >
                  <Menu size={22} />
                </button>
              </DialogTrigger>
              <DialogContent
                title="Pulse AI"
                description="Team workspace navigation"
                side="left"
              >
                {navigation}
              </DialogContent>
            </Dialog>
            <div className={shell.mobileProduct}>{identity}</div>
            <nav aria-label="Breadcrumb">
              <ol className={shell.breadcrumbs}>
                <li>{session?.role.toLowerCase() ?? "Team workspace"}</li>
                <li aria-current="page">{current?.label ?? "Overview"}</li>
              </ol>
            </nav>
          </div>
          <div className={shell.headerActions}>
            {session?.demoAuth && (
              <Button
                variant="ghost"
                size="small"
                onClick={() =>
                  void execute(async () => {
                    await fetch("/api/demo-session", { method: "DELETE" });
                    setSession(null);
                    router.push("/" as Route);
                  }, "Signed out.")
                }
              >
                <LogOut size={16} aria-hidden="true" />
                Switch role / sign out
              </Button>
            )}
            {profile}
          </div>
        </header>
        <main
          className={`${shell.content} ${styles.portalContent}`}
          id="main-content"
        >
          {session === undefined ? (
            <p role="status">Opening Director workspace…</p>
          ) : session === null ? (
            <Alert
              title="Could not open the workspace"
              tone="error"
              action={
                <Button
                  variant="secondary"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              }
            >
              {error}
              <Link href="/">Choose a role</Link>
            </Alert>
          ) : (
            <PortalContext.Provider
              value={{ session, period, setPeriod, refresh, busy, execute }}
            >
              <div className={styles.stack}>
                {error && (
                  <div role="alert">
                    <Alert tone="error" title="Action could not be completed">
                      <span className={styles.notice}>{error}</span>
                    </Alert>
                  </div>
                )}
                {message && (
                  <div role="status">
                    <Alert tone="success" title={message}>
                      Your workspace is up to date.
                    </Alert>
                  </div>
                )}
                {current && !current.roles.includes(session.role) ? (
                  <Alert title="Access unavailable" tone="error">
                    Your role does not have access to this page.
                  </Alert>
                ) : (
                  children
                )}
              </div>
            </PortalContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}
