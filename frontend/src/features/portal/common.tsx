"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "./api";
import { usePortal } from "./portal-shell";
import type { ReportRow } from "./types";
import styles from "./portal.module.css";
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
  return (
    <label className={styles.field}>
      Billing month
      <input
        type="month"
        value={period}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) setPeriod(e.target.value);
        }}
      />
    </label>
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
