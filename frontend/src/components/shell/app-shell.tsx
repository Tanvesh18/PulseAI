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
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  assistantPreview,
  employeeNotifications,
  employeeProfile,
} from "@/features/employee/data/mock-employee";
import {
  askAssistant,
  getEmployeeProfile,
  listNotifications,
  markNotificationRead,
} from "@/features/employee/data/employee-api";
import type {
  AssistantAnswer,
  EmployeeNotification,
  EmployeeProfile,
} from "@/features/employee/types";
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

function ProfileSummary({
  profile = employeeProfile,
}: {
  profile?: EmployeeProfile;
}) {
  return (
    <div className={styles.profileSummary}>
      <span className={styles.avatar} aria-hidden="true">
        {profile.initials}
      </span>
      <span className={styles.profileCopy}>
        <strong>{profile.name}</strong>
        <span>
          {profile.role} · {profile.organization}
        </span>
      </span>
    </div>
  );
}

function NotificationDrawer() {
  const [notifications, setNotifications] = useState<EmployeeNotification[]>(
    employeeNotifications,
  );
  const unreadCount = notifications.filter(
    (notification) => !notification.read,
  ).length;

  useEffect(() => {
    let active = true;
    listNotifications()
      .then((result) => {
        if (active) setNotifications(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function readNotification(notificationId: string) {
    setNotifications((current) =>
      current.map((item) =>
        item.id === notificationId ? { ...item, read: true } : item,
      ),
    );
    void markNotificationRead(notificationId).catch(() => undefined);
  }

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
            {notifications.map((notification) => (
              <li
                className={`${styles.notificationItem} ${notification.read ? "" : styles.notificationUnread}`}
                key={notification.id}
              >
                <span className={styles.notificationIcon} aria-hidden="true">
                  <Clock3 size={18} />
                </span>
                <Link
                  href={notification.href as Route}
                  onClick={() => readNotification(notification.id)}
                >
                  <strong>{notification.title}</strong>
                  <p>{notification.message}</p>
                  <time dateTime={notification.createdAt}>
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(notification.createdAt))}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssistantDrawer() {
  const [response, setResponse] = useState<AssistantAnswer | null>(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runQuery(nextQuestion: string) {
    if (!nextQuestion.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      setResponse(await askAssistant(nextQuestion));
      setQuestion("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The assistant is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void runQuery(question);
  }

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
        description="Read-only · Employee scope · Live timesheet data"
        side="right"
      >
        <div className={styles.assistantPanel}>
          <div className={styles.assistantContext}>
            <Badge tone="secondary">Aug 24–30, 2026</Badge>
            <span>Updated from the current demo timesheet</span>
          </div>

          <div className={styles.assistantMessage} aria-live="polite">
            <span className={styles.assistantMessageLabel}>AI response</span>
            <p>
              {response?.answer ??
                "Ask for a summary, the current status, or the hours remaining in your timesheet."}
            </p>
            {response?.sources.map((source) => (
              <Link key={source.href} href={source.href as Route}>
                View source: {source.label}
              </Link>
            ))}
          </div>

          <div className={styles.suggestionGroup}>
            <h3>Suggested questions</h3>
            <div className={styles.suggestionList}>
              {assistantPreview.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void runQuery(suggestion)}
                  disabled={loading}
                >
                  {suggestion}
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          </div>

          <form className={styles.assistantComposer} onSubmit={submit}>
            <label htmlFor="assistant-message">Ask about your timesheets</label>
            <div>
              <input
                id="assistant-message"
                placeholder="Ask about your current timesheet"
                value={question}
                maxLength={300}
                onChange={(event) => setQuestion(event.target.value)}
              />
              <Button
                size="icon"
                disabled={loading || question.trim().length < 2}
                aria-label="Send message"
              >
                <Send aria-hidden="true" size={18} />
              </Button>
            </div>
            <p>
              {error ??
                "The assistant is read-only and cannot submit or approve records."}
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
  const [profile, setProfile] = useState<EmployeeProfile>(employeeProfile);

  useEffect(() => {
    let active = true;
    getEmployeeProfile()
      .then((result) => {
        if (active) setProfile(result);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <ProductIdentity />
        <EmployeeNavigation />
        <ProfileSummary profile={profile} />
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
              <ProfileSummary profile={profile} />
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
