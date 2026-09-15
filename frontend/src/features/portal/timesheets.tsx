"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/page-header";
import { api, download } from "./api";
import { usePortal } from "./portal-shell";
import { DataState, MonthFilter, Status, useData } from "./common";
import type { Employee, Master, Row, Sheet } from "./types";
import styles from "./portal.module.css";

function SharedResource({
  sheet,
  masters,
  close,
}: {
  sheet: Sheet;
  masters: Master[];
  close: () => void;
}) {
  const { data: employees, error } = useData<Employee[]>("employees");
  const { busy, execute } = usePortal();
  const [code, setCode] = useState("");
  const [project, setProject] = useState(
    masters.find((m) => m.kind === "project")?.code ?? "",
  );
  const [hours, setHours] = useState(167);
  const employee = employees?.find((e) => e.code === code);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        title="Add shared resource"
        description="Choose an employee from the HR master and enter this assignment?s hours."
      >
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            void execute(async () => {
              await api(`timesheets/${sheet.id}/shared`, {
                expectedVersion: sheet.version,
                employeeCode: code,
                projectCode: project,
                costCenter: sheet.costCenter,
                hours,
              });
              close();
            }, "Shared resource added.");
          }}
        >
          <DataState error={error} loading={!employees} />
          <label className={styles.field}>
            Employee code
            <select
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            >
              <option value="">Select an employee</option>
              {employees
                ?.filter(
                  (e) => !sheet.rows.some((r) => r.employeeCode === e.code),
                )
                .map((e) => (
                  <option key={e.code} value={e.code}>
                    {e.code} ? {e.name}
                  </option>
                ))}
            </select>
          </label>
          {employee && (
            <p>
              {employee.name} ? {employee.businessGroup} ? {employee.grade}
            </p>
          )}
          <label className={styles.field}>
            Project code
            <select
              required
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              {masters
                .filter((m) => m.kind === "project")
                .map((m) => (
                  <option key={m.id} value={m.code}>
                    {m.code}
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            Cost center
            <input value={sheet.costCenter} readOnly />
          </label>
          <label className={styles.field}>
            Hours
            <input
              type="number"
              required
              min="0.01"
              max="744"
              step="0.01"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            />
          </label>
          <Button type="submit" disabled={busy || !employee}>
            Add resource
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function SheetEditor({
  sheet,
  masters,
  review = false,
}: {
  sheet: Sheet;
  masters: Master[];
  review?: boolean;
}) {
  const { session, busy, execute } = usePortal();
  const [rows, setRows] = useState<Row[]>(sheet.rows);
  const [modal, setModal] = useState<"submit" | "shared" | null>(null);
  const [remove, setRemove] = useState<Row | null>(null);
  const editable =
    !review &&
    !sheet.exportedAt &&
    (session.role === "FINANCE" ||
      (session.role === "MANAGER" &&
        ["DRAFT", "REJECTED"].includes(sheet.status)));
  const dirty = JSON.stringify(rows) !== JSON.stringify(sheet.rows);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function update(id: string, key: keyof Row, value: string | number) {
    setRows((current) =>
      current.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    );
  }
  async function save() {
    return dirty
      ? api<Sheet>(
          `timesheets/${sheet.id}`,
          { rows, expectedVersion: sheet.version },
          "PATCH",
        )
      : sheet;
  }
  const columns: [keyof Row, string][] = [
    ["employeeCode", "Employee code"],
    ["employeeName", "Employee name"],
    ["businessGroup", "Business group"],
    ["grade", "Oracle grade"],
    ["billingGrade", "Billing grade"],
    ["costCenter", "Cost center"],
    ["projectCode", "Project code"],
    ["location", "US / Non-US"],
    ["usState", "US state"],
    ["hours", "Hours"],
    ["remarks", "Remarks"],
  ];
  const total = rows.reduce((sum, row) => sum + row.hours, 0);
  const short = rows.filter((row) => row.hours < row.expectedHours);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Status value={sheet.status} />
        {sheet.exportedAt && <span>Exported ? locked</span>}
        <span>
          {sheet.businessGroup} ? {sheet.costCenter} ? {rows.length} rows ?{" "}
          {total.toFixed(2)} hours
        </span>
        {editable && (
          <>
            <Button
              variant="secondary"
              disabled={
                busy || dirty || !["DRAFT", "REJECTED"].includes(sheet.status)
              }
              onClick={() => setModal("shared")}
            >
              Add shared resource
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !dirty}
              onClick={() => void execute(save, "Timesheet saved.")}
            >
              Save draft
            </Button>
            {["DRAFT", "REJECTED"].includes(sheet.status) && (
              <Button disabled={busy} onClick={() => setModal("submit")}>
                Submit for approval
              </Button>
            )}
          </>
        )}
      </div>
      {sheet.returnReason && (
        <Alert tone="warning" title="Returned for correction">
          {sheet.returnReason}
        </Alert>
      )}
      {dirty && (
        <p role="status">
          Unsaved changes. Save before switching periods or adding resources.
        </p>
      )}
      {short.length > 0 && (
        <Alert
          tone="warning"
          title={`${short.length} rows below expected hours`}
        >
          Add a remark to each short-hours row before submitting. Pro-rated and
          travel rows use their own expected hours.
        </Alert>
      )}
      {session.role === "FINANCE" && sheet.status === "APPROVED" && !review && (
        <Alert title="Finance correction">
          Saving changes to approved hours sends the timesheet back for director
          approval.
        </Alert>
      )}
      <div
        className={styles.table}
        tabIndex={0}
        role="region"
        aria-label="Monthly timesheet"
      >
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key} scope="col">
                  {label}
                </th>
              ))}
              <th scope="col">Expected</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map(([key, label]) => {
                  const canEdit =
                    editable &&
                    !["employeeCode", "employeeName"].includes(key) &&
                    (session.role === "FINANCE" ||
                      !["businessGroup", "grade", "billingGrade"].includes(
                        key,
                      ));
                  const options =
                    key === "location"
                      ? ["Non-US", "US"]
                      : key === "projectCode"
                        ? masters
                            .filter((m) => m.kind === "project")
                            .map((m) => m.code)
                        : key === "costCenter"
                          ? masters
                              .filter(
                                (m) =>
                                  m.kind === "cost-center" &&
                                  (session.role !== "MANAGER" ||
                                    session.costCenters.includes(m.code)),
                              )
                              .map((m) => m.code)
                          : key === "businessGroup"
                            ? masters
                                .filter((m) => m.kind === "business-group")
                                .map((m) => m.code)
                            : null;
                  return (
                    <td
                      key={key}
                      className={
                        key === "hours" && row.hours < row.expectedHours
                          ? styles.short
                          : ""
                      }
                    >
                      {canEdit ? (
                        options ? (
                          <select
                            className={styles.cell}
                            aria-label={`${row.employeeName} ${label}`}
                            value={String(row[key])}
                            onChange={(e) =>
                              update(row.id, key, e.target.value)
                            }
                          >
                            {options.map((option) => (
                              <option key={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className={`${styles.cell} ${key === "hours" ? styles.hours : ""}`}
                            type={key === "hours" ? "number" : "text"}
                            aria-label={`${row.employeeName} ${label}`}
                            value={String(row[key])}
                            min={0}
                            max={744}
                            step="0.01"
                            maxLength={500}
                            onChange={(e) =>
                              update(
                                row.id,
                                key,
                                key === "hours"
                                  ? Number(e.target.value)
                                  : e.target.value,
                              )
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                          />
                        )
                      ) : (
                        String(row[key])
                      )}
                    </td>
                  );
                })}
                <td>{row.expectedHours}</td>
                <td>
                  {row.shared && editable ? (
                    <Button
                      variant="ghost"
                      size="small"
                      disabled={busy || dirty}
                      onClick={() => setRemove(row)}
                    >
                      Remove shared
                    </Button>
                  ) : row.shared ? (
                    "Shared resource"
                  ) : (
                    "HR employee"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal === "shared" && (
        <SharedResource
          sheet={sheet}
          masters={masters}
          close={() => setModal(null)}
        />
      )}
      <Dialog
        open={modal === "submit"}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent
          title="Submit for approval"
          description="The timesheet will lock and notify the director."
        >
          <div className={styles.form}>
            <p>
              {rows.length} rows ? {total.toFixed(2)} hours ? {sheet.period} ?
              cost center {sheet.costCenter}
            </p>
            {short.some((row) => !row.remarks.trim()) && (
              <Alert title="Remarks required" tone="warning">
                Fill in the remarks for every short-hours row before submitting.
              </Alert>
            )}
            <Button
              disabled={busy || short.some((row) => !row.remarks.trim())}
              onClick={() =>
                void execute(async () => {
                  const saved = await save();
                  await api(`timesheets/${sheet.id}/action`, {
                    action: "submit",
                    expectedVersion: saved.version,
                  });
                  setModal(null);
                }, "Timesheet submitted for approval.")
              }
            >
              Confirm submit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(remove)}
        onOpenChange={(open) => {
          if (!open) setRemove(null);
        }}
      >
        <DialogContent
          title="Remove shared resource"
          description={`${remove?.employeeName ?? ""} will be removed from this draft only.`}
        >
          <Button
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                await api(`timesheets/${sheet.id}/shared`, {
                  expectedVersion: sheet.version,
                  removeId: remove?.id,
                });
                setRemove(null);
              }, "Shared resource removed.")
            }
          >
            Confirm removal
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function Timesheets() {
  const { period } = usePortal();
  const { data: sheets, error } = useData<Sheet[]>(
    `timesheets?period=${period}`,
  );
  const { data: masters } = useData<Master[]>("masters");
  const [center, setCenter] = useState("");
  const [group, setGroup] = useState("");
  const filtered =
    sheets?.filter((s) => !group || s.businessGroup === group) ?? [];
  const selected = filtered.find((s) => s.costCenter === center) ?? filtered[0];
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Team timesheets"
        description="Review monthly hours, add remarks, and submit your team?s timesheet."
      />
      <div className={styles.toolbar}>
        <MonthFilter />
        <label className={styles.field}>
          Business group
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All business groups</option>
            {[...new Set(sheets?.map((s) => s.businessGroup))].map((bg) => (
              <option key={bg}>{bg}</option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Cost center
          <select
            value={selected?.costCenter ?? ""}
            onChange={(e) => setCenter(e.target.value)}
          >
            {filtered.map((s) => (
              <option key={s.id}>{s.costCenter}</option>
            ))}
          </select>
        </label>
      </div>
      <DataState error={error} loading={!sheets || !masters} />
      {selected && masters && (
        <SheetEditor
          key={`${selected.id}-${selected.version}`}
          sheet={selected}
          masters={masters}
        />
      )}
      {sheets && !selected && (
        <Alert title="No timesheets for this period">
          HR can upload the employee workbook to generate monthly timesheets.
        </Alert>
      )}
    </div>
  );
}
export function Approvals() {
  const { period, busy, execute, session } = usePortal();
  const { data: sheets, error } = useData<Sheet[]>(
    `timesheets?period=${period}`,
  );
  const [review, setReview] = useState<Sheet | null>(null);
  const [decision, setDecision] = useState<{
    sheet: Sheet;
    action: "approve" | "return";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const approved = sheets?.filter((sheet) => sheet.status === "APPROVED") ?? [];
  const pending =
    sheets?.filter((s) => ["SUBMITTED", "RESUBMITTED"].includes(s.status)) ??
    [];
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Approvals"
        description="Review submitted timesheets, then approve or return them with a reason."
        action={
          session.role === "FINANCE" && (
            <Button
              disabled={busy || approved.length === 0}
              onClick={() => setExportOpen(true)}
            >
              Export approved hours
            </Button>
          )
        }
      />
      <MonthFilter />
      <DataState error={error} loading={!sheets} />
      <p>{pending.length} timesheets awaiting review</p>
      {session.role === "FINANCE" && sheets && (
        <section className={styles.panel}>
          <h2>Export summary</h2>
          <p>
            {approved.length} approved timesheets for {period}. Review the
            summary before downloading an Excel staging workbook.
          </p>
          {approved.length === 0 && (
            <p className={styles.muted}>
              Approve a submitted timesheet to enable export.
            </p>
          )}
        </section>
      )}
      <div className={styles.table}>
        <table>
          <thead>
            <tr>
              <th>Business group</th>
              <th>Cost center</th>
              <th>Hours</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sheets?.map((sheet) => (
              <tr key={sheet.id}>
                <td>{sheet.businessGroup}</td>
                <td>{sheet.costCenter}</td>
                <td>
                  {sheet.rows.reduce((sum, r) => sum + r.hours, 0).toFixed(2)}
                </td>
                <td>
                  <Status value={sheet.status} />
                </td>
                <td>
                  <div className={styles.toolbar}>
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setReview(sheet)}
                    >
                      Review
                    </Button>
                    {["SUBMITTED", "RESUBMITTED"].includes(sheet.status) && (
                      <>
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            setDecision({ sheet, action: "approve" })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          variant="secondary"
                          size="small"
                          disabled={busy}
                          onClick={() => {
                            setReason("");
                            setDecision({ sheet, action: "return" });
                          }}
                        >
                          Return
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sheets?.length === 0 && (
          <p className={styles.empty}>No timesheets in this billing period.</p>
        )}
      </div>
      <Dialog
        open={Boolean(review)}
        onOpenChange={(open) => {
          if (!open) setReview(null);
        }}
      >
        <DialogContent
          title="Review timesheet"
          description={`${review?.businessGroup ?? ""} ? ${review?.period ?? ""}`}
        >
          {review && (
            <>
              <SheetEditor sheet={review} masters={[]} review />
              {session.role === "FINANCE" && (
                <Link href={"/timesheets" as Route}>
                  Open team timesheets to make a Finance correction
                </Link>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(decision)}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
      >
        <DialogContent
          title={
            decision?.action === "return"
              ? "Return for correction"
              : "Approve timesheet"
          }
          description={`${decision?.sheet.businessGroup ?? ""} ? cost center ${decision?.sheet.costCenter ?? ""}`}
        >
          <div className={styles.form}>
            {decision?.action === "return" && (
              <label className={styles.field}>
                Reason for return
                <textarea
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                  required
                />
              </label>
            )}
            <Button
              disabled={
                busy || (decision?.action === "return" && !reason.trim())
              }
              onClick={() =>
                void execute(
                  async () => {
                    if (!decision) return;
                    await api(`timesheets/${decision.sheet.id}/action`, {
                      action: decision.action,
                      expectedVersion: decision.sheet.version,
                      reason,
                    });
                    setDecision(null);
                  },
                  decision?.action === "return"
                    ? "Timesheet returned to manager."
                    : "Timesheet approved.",
                )
              }
            >
              Confirm {decision?.action}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent
          title="Export approved hours"
          description="Download an Excel staging workbook for the selected billing period."
        >
          <div className={styles.form}>
            <p>
              Includes approved rows only. Zero hours, missing codes, and
              non-back-charging cost centers are excluded. Billing and FX rates
              must be configured.
            </p>
            <div className={styles.table}>
              <table>
                <caption>
                  Approved timesheets for {period}, before export exclusions
                </caption>
                <thead>
                  <tr>
                    <th>Business group</th>
                    <th>Cost center</th>
                    <th>Employees</th>
                    <th>Recorded hours</th>
                  </tr>
                </thead>
                <tbody>
                  {approved.map((sheet) => (
                    <tr key={sheet.id}>
                      <td>{sheet.businessGroup}</td>
                      <td>{sheet.costCenter}</td>
                      <td>
                        {
                          new Set(sheet.rows.map((row) => row.employeeCode))
                            .size
                        }
                      </td>
                      <td>
                        {sheet.rows
                          .reduce((sum, row) => sum + row.hours, 0)
                          .toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Alert title="Oracle integration">
              This is a staging workbook. An approved Web ADI template and
              Oracle credentials are needed for direct upload.
            </Alert>
            <Button
              disabled={busy}
              onClick={() =>
                void execute(async () => {
                  await download(
                    "exports/oracle",
                    `oracle-staging-${period}.xlsx`,
                    { period },
                  );
                  setExportOpen(false);
                }, "Export downloaded.")
              }
            >
              Download Excel export
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
