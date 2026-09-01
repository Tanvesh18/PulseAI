import type { ReactNode } from "react";
import styles from "../employee.module.css";

type PageHeaderProps = {
  action?: ReactNode;
  description: string;
  meta?: ReactNode;
  title: string;
};

export function PageHeader({
  action,
  description,
  meta,
  title,
}: PageHeaderProps) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderCopy}>
        <div className={styles.pageTitleRow}>
          <h1>{title}</h1>
          {meta}
        </div>
        <p>{description}</p>
      </div>
      {action ? <div className={styles.pageHeaderAction}>{action}</div> : null}
    </header>
  );
}
