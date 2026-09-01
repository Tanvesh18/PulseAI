"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  Bot,
  CalendarDays,
  ChevronRight,
  Clock3,
  History,
  LayoutDashboard,
  Menu,
  Send,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  assistantPreview,
  employeeNotifications,
  employeeProfile,
} from "@/features/employee/data/mock-employee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import styles from "./app-shell.module.css";

const navigation = [
  { href: "/employee", label: "Overview", icon: LayoutDashboard },
  {
    href: "/employee/timesheets/current",
    label: "My timesheet",
    icon: CalendarDays,
  },
  {
    href: "/employee/timesheets/history",
    label: "Timesheet history",
    icon: History,
  },
] as const satisfies ReadonlyArray<{
  href: Route;
  icon: typeof LayoutDashboard;
  label: string;
}>;

const pageNames: Record<string, string> = {
  "/employee": "Overview",
  "/employee/timesheets/current": "My timesheet",
  "/employee/timesheets/history": "Timesheet history",
};

function isActiveRoute(pathname: string, href: Route): boolean {
  if (href === "/employee") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function EmployeeNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className={styles.navigation} aria-label="Employee navigation">
      <p className={styles.navigationLabel}>Workspace</p>
      <ul>
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = isActiveRoute(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                className={`${styles.navigationLink} ${active ? styles.navigationLinkActive : ""}`}
                href={item.href}
                aria-current={active ? "page" : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
              >
                <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ProductIdentity() {
  return (
    <Link className={styles.productIdentity} href="/employee">
      <span className={styles.productMark} aria-hidden="true">
        <Activity size={22} strokeWidth={2} />
      </span>
      <span>Pulse AI</span>
    </Link>
  );
}

function ProfileSummary() {
  return (
    <div className={styles.profileSummary}>
      <span className={styles.avatar} aria-hidden="true">
        {employeeProfile.initials}
      </span>
      <span className={styles.profileCopy}>
        <strong>{employeeProfile.name}</strong>
        <span>
          {employeeProfile.role} · {employeeProfile.organization}
        </span>
      </span>
    </div>
  );
}

function NotificationDrawer() {
  const unreadCount = employeeNotifications.filter(
    (notification) => !notification.read,
  ).length;

  return (
    <Dialog>
      <Tooltip label="Notifications">
        <DialogTrigger asChild>
          <button
            className={styles.iconTrigger}
            aria-label={`Open notifications, ${unreadCount} unread`}
          >
            <Bell aria-hidden="true" size={20} />
            <span className={styles.notificationCount}>{unreadCount}</span>
          </button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent
        title="Notifications"
        description={`${unreadCount} unread in your employee workspace`}
        side="right"
      >
        <div className={styles.notificationGroup}>
          <h3>Recent</h3>
          <ul className={styles.notificationList}>
            {employeeNotifications.map((notification) => (
              <li
                className={`${styles.notificationItem} ${notification.read ? "" : styles.notificationUnread}`}
                key={notification.id}
              >
                <span className={styles.notificationIcon} aria-hidden="true">
                  <Clock3 size={18} />
                </span>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <time>{notification.when}</time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssistantDrawer() {
  const [response, setResponse] = useState<string>(
    assistantPreview.responses["Summarize my current timesheet"],
  );

  return (
    <Dialog>
      <Tooltip label="Pulse AI Assistant">
        <DialogTrigger asChild>
          <button
            className={styles.assistantTrigger}
            aria-label="Open Pulse AI Assistant"
          >
            <Bot aria-hidden="true" size={19} />
            <span>Assistant</span>
          </button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent
        title="Pulse AI Assistant"
        description="Read-only · Employee scope · Demo data"
        side="right"
      >
        <div className={styles.assistantPanel}>
          <div className={styles.assistantContext}>
            <Badge tone="secondary">Aug 24–30, 2026</Badge>
            <span>Updated from the current demo timesheet</span>
          </div>

          <div className={styles.assistantMessage} aria-live="polite">
            <span className={styles.assistantMessageLabel}>AI response</span>
            <p>{response}</p>
          </div>

          <div className={styles.suggestionGroup}>
            <h3>Suggested questions</h3>
            <div className={styles.suggestionList}>
              {assistantPreview.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() =>
                    setResponse(assistantPreview.responses[suggestion])
                  }
                >
                  {suggestion}
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          </div>

          <form
            className={styles.assistantComposer}
            onSubmit={(event) => event.preventDefault()}
          >
            <label htmlFor="assistant-message">Ask about your timesheets</label>
            <div>
              <input
                id="assistant-message"
                placeholder="Use a suggested question in this demo"
                disabled
              />
              <Button size="icon" disabled aria-label="Send message">
                <Send aria-hidden="true" size={18} />
              </Button>
            </div>
            <p>
              The assistant is read-only and cannot submit or approve records.
            </p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip label="Open navigation">
        <DialogTrigger asChild>
          <button
            className={styles.mobileMenuTrigger}
            aria-label="Open navigation"
          >
            <Menu aria-hidden="true" size={22} />
          </button>
        </DialogTrigger>
      </Tooltip>
      <DialogContent
        title="Pulse AI"
        description="Employee workspace navigation"
        side="left"
      >
        <div className={styles.mobileNavigationContent}>
          <EmployeeNavigation onNavigate={() => setOpen(false)} />
          <div className={styles.mobileProfile}>
            <ProfileSummary />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const currentPage = pageNames[pathname] ?? "Timesheet detail";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <ProductIdentity />
        <EmployeeNavigation />
        <ProfileSummary />
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topHeader}>
          <div className={styles.headerIdentity}>
            <MobileNavigation />
            <div className={styles.mobileProduct}>
              <ProductIdentity />
            </div>
            <nav aria-label="Breadcrumb">
              <ol className={styles.breadcrumbs}>
                <li>Employee</li>
                <li aria-hidden="true">
                  <ChevronRight size={15} />
                </li>
                <li aria-current="page">{currentPage}</li>
              </ol>
            </nav>
          </div>

          <div className={styles.headerActions}>
            <AssistantDrawer />
            <NotificationDrawer />
            <div className={styles.headerProfile}>
              <ProfileSummary />
            </div>
          </div>
        </header>

        <main className={styles.content} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
