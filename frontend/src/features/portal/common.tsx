"use client";
import { useEffect, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { api } from "./api";
import { usePortal } from "./portal-shell";
import type { ReportRow } from "./types";
import styles from "./portal.module.css";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function billingMonthLabel(value: string) {
  const [year, month] = value.split("-");
  const monthIndex = Number(month) - 1;
  return `${monthNames[monthIndex] ?? "Select a month"} ${year ?? ""}`.trim();
}
export function useData<T>(path: string) {
  const { refresh } = usePortal();
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
  }>({ path: "", data: null, error: "" });
  useEffect(() => {
    let active = true;
    void api<T>(path)
      .then((data) => {
        if (active) setState({ path, data, error: "" });
      })
      .catch((e: unknown) => {
        if (active)
          setState({
            path,
            data: null,
            error: e instanceof Error ? e.message : "Could not load data.",
          });
      });
    return () => {
      active = false;
    };
  }, [path, refresh]);
  return state.path === path ? state : { data: null, error: "" };
}
export function Status({ value }: { value: string }) {
  return (
    <Badge
      tone={
        value === "APPROVED"
          ? "approved"
          : value === "REJECTED"
            ? "rejected"
            : value === "DRAFT"
              ? "secondary"
              : "pending"
      }
    >
      {value.toLowerCase()}
    </Badge>
  );
}
export function MonthFilter() {
  const { period, setPeriod, busy } = usePortal();
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(() =>
    Number(period.slice(0, 4)),
  );
  const selectedYear = Number(period.slice(0, 4));
  const selectedMonth = Number(period.slice(5, 7));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setVisibleYear(selectedYear);
        setOpen(nextOpen);
      }}
    >
      <div className={styles.field}>
        <span>Billing month</span>
        <DialogTrigger asChild>
          <button
            className={styles.monthPickerTrigger}
            type="button"
            disabled={busy}
            aria-label={`Billing month: ${billingMonthLabel(period)}`}
          >
            <CalendarDays aria-hidden="true" size={18} />
            <span>{billingMonthLabel(period)}</span>
          </button>
        </DialogTrigger>
      </div>
      <DialogContent
        title="Choose billing month"
        description="Select the month whose records you want to review."
      >
        <div className={styles.monthPicker}>
          <div className={styles.monthPickerYear}>
            <button
              type="button"
              className={styles.monthPickerYearButton}
              aria-label="Previous year"
              onClick={() => setVisibleYear((year) => year - 1)}
            >
              <ChevronLeft aria-hidden="true" size={20} />
            </button>
            <strong aria-live="polite">{visibleYear}</strong>
            <button
              type="button"
              className={styles.monthPickerYearButton}
              aria-label="Next year"
              onClick={() => setVisibleYear((year) => year + 1)}
            >
              <ChevronRight aria-hidden="true" size={20} />
            </button>
          </div>
          <div
            className={styles.monthPickerGrid}
            aria-label={`${visibleYear} months`}
          >
            {monthNames.map((month, index) => {
              const monthNumber = index + 1;
              const isSelected =
                selectedYear === visibleYear && selectedMonth === monthNumber;
              return (
                <button
                  key={month}
                  type="button"
                  className={styles.monthPickerMonth}
                  data-selected={isSelected || undefined}
                  aria-pressed={isSelected}
                  disabled={busy}
                  onClick={() => {
                    setPeriod(
                      `${visibleYear}-${String(monthNumber).padStart(2, "0")}`,
                    );
                    setOpen(false);
                  }}
                >
                  {month.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function DataState({
  error,
  loading,
}: {
  error: string;
  loading: boolean;
}) {
  const { execute } = usePortal();
  return error ? (
    <Alert
      title="Could not load this page"
      tone="error"
      action={
        <Button
          variant="secondary"
          onClick={() => void execute(() => Promise.resolve(), "Retrying?")}
        >
          Retry
        </Button>
      }
    >
      {error}
    </Alert>
  ) : loading ? (
    <p role="status">Loading records?</p>
  ) : null;
}
export function ReportTable({
  rows,
  caption,
}: {
  rows: ReportRow[];
  caption: string;
}) {
  const keys = Object.keys(rows[0] ?? {});
  return (
    <div className={styles.table}>
      {rows.length ? (
        <table>
          <caption>
            {caption} ? {rows.length} records
          </caption>
          <thead>
            <tr>
              {keys.map((key) => (
                <th key={key} scope="col">
                  {key}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {keys.map((key) => (
                  <td key={key}>{row[key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>No records match these filters.</p>
      )}
    </div>
  );
}
