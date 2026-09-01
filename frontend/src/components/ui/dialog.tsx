"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "./tooltip";
import styles from "./ui.module.css";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

type DialogContentProps = {
  children: ReactNode;
  description: string;
  footer?: ReactNode;
  side?: "center" | "right" | "left";
  title: string;
};

export function DialogContent({
  children,
  description,
  footer,
  side = "center",
  title,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={styles.dialogOverlay} />
      <DialogPrimitive.Content
        className={`${styles.dialogContent} ${styles[`dialog-${side}`]}`}
      >
        <header className={styles.dialogHeader}>
          <div>
            <DialogPrimitive.Title className={styles.dialogTitle}>
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className={styles.dialogDescription}>
              {description}
            </DialogPrimitive.Description>
          </div>
          <Tooltip label="Close">
            <DialogPrimitive.Close
              className={styles.dialogClose}
              aria-label="Close"
            >
              <X aria-hidden="true" size={20} />
            </DialogPrimitive.Close>
          </Tooltip>
        </header>
        <div className={styles.dialogBody}>{children}</div>
        {footer ? (
          <footer className={styles.dialogFooter}>{footer}</footer>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
