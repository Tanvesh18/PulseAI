import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Info,
  ScanSearch,
} from "lucide-react";
import type { ReactNode } from "react";
import styles from "./ui.module.css";

type AlertTone = "warning" | "error" | "info" | "anomaly" | "success";

const alertIcons = {
  warning: AlertTriangle,
  error: CircleAlert,
  info: Info,
  anomaly: ScanSearch,
  success: CheckCircle2,
} satisfies Record<AlertTone, typeof Info>;

type AlertProps = {
  action?: ReactNode;
  children: ReactNode;
  title: string;
  tone?: AlertTone;
};

export function Alert({ action, children, title, tone = "info" }: AlertProps) {
  const Icon = alertIcons[tone];

  return (
    <section
      className={`${styles.alert} ${styles[`alert-${tone}`]}`}
      aria-label={title}
    >
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
      <div className={styles.alertBody}>
        <p className={styles.alertTitle}>{title}</p>
        <div className={styles.alertCopy}>{children}</div>
      </div>
      {action ? <div className={styles.alertAction}>{action}</div> : null}
    </section>
  );
}
