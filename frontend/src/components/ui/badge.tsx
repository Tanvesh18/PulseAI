import {
  AlertTriangle,
  CheckCircle2,
  CircleMinus,
  Clock3,
  FilePenLine,
  Info,
  LockKeyhole,
  ScanSearch,
  Send,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

export type BadgeTone =
  | "secondary"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "pending"
  | "approved"
  | "rejected"
  | "anomaly"
  | "disabled";

const toneIcons = {
  secondary: FilePenLine,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  info: Info,
  pending: Clock3,
  approved: CheckCircle2,
  rejected: XCircle,
  anomaly: ScanSearch,
  disabled: CircleMinus,
} satisfies Record<BadgeTone, typeof Info>;

type BadgeProps = {
  children: ReactNode;
  icon?: "default" | "lock" | "send";
  tone?: BadgeTone;
};

export function Badge({
  children,
  icon = "default",
  tone = "secondary",
}: BadgeProps) {
  const Icon =
    icon === "lock" ? LockKeyhole : icon === "send" ? Send : toneIcons[tone];

  return (
    <span className={`${styles.badge} ${styles[`badge-${tone}`]}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2} />
      {children}
    </span>
  );
}
