"use client";
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { PageHeader } from "@/features/employee/components/page-header";
import { api, download, fileBody } from "./api";
import { usePortal } from "./portal-shell";
import { DataState, MonthFilter, ReportTable, Status, useData } from "./common";
import { Approvals, Timesheets } from "./timesheets";
import type {
  Access,
  Audit,
  Employee,
  ImportSummary,
  Master,
  Notice,
  Overview,
  ReportRow,
} from "./types";
import styles from "./portal.module.css";

function Dashboard() {
  const { period, session, busy, execute } = usePortal();
  const { data, error } = useData<Overview>(`overview?period=${period}`);
  const submitted =
    data?.sheets.filter((s) =>
      ["SUBMITTED", "RESUBMITTED", "APPROVED"].includes(s.status),
    ).length ?? 0;
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Overview"
        description={`Welcome, ${session.name}. Track the monthly billing workflow in your scope.`}
        action={<MonthFilter />}
      />
      {session.role === "FINANCE" && (
        <div className={styles.toolbar}>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void execute(
                () => api("reminders", { period, kind: "hr" }),
                "HR upload request sent in the portal.",
              )
            }
          >
            Request HR workbook
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void execute(
                () => api("reminders", { period, kind: "managers" }),
                "Submission reminders sent in the portal.",
              )
            }
          >
            Remind pending managers
          </Button>
        </div>
      )}
      <DataState error={error} loading={!data} />
      {data && (
        <>
          <section className={styles.panel}>
            <h2>Billing cycle workflow</h2>
            <p>
              {data.cycle.start} ? {data.cycle.end} ? {data.cycle.standardHours}{" "}
              configured standard hours
            </p>
            <ol className={styles.flow}>
              {[
                "Cycle initiated",
                "HR data uploaded",
                "Travel updated",
                "Timesheet entry",
                "Manager submit",
                "Director approval",
                "Finance export",
              ].map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <dl className={styles.metrics}>
              <div>
                <dt>Employees in scope</dt>
                <dd>{data.employees}</dd>
              </div>
              <div>
                <dt>Submitted / approved</dt>
                <dd>{submitted}</dd>
              </div>
              <div>
                <dt>Awaiting submission</dt>
                <dd>{data.sheets.length - submitted}</dd>
              </div>
              <div>
                <dt>Short-hours rows</dt>
                <dd>{data.shortHours}</dd>
              </div>
            </dl>
          </section>
          {data.shortHours > 0 && (
            <Alert title="Remarks needed" tone="warning">
              {data.shortHours} rows are below their expected hours. Managers
              must explain short hours before submission.
            </Alert>
          )}
          <div className={styles.table}>
            <table>
              <caption>Business group submission status</caption>
              <thead>
                <tr>
                  <th>Business group</th>
                  <th>Cost center</th>
                  <th>Employees</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {data.sheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>{sheet.businessGroup}</td>
                    <td>{sheet.costCenter}</td>
                    <td>
                      {new Set(sheet.rows.map((r) => r.employeeCode)).size}
                    </td>
                    <td>
                      {sheet.rows
                        .reduce((sum, r) => sum + r.hours, 0)
                        .toFixed(2)}
                    </td>
                    <td>
                      <Status value={sheet.status} />
                    </td>
                    <td>
                      <Link
                        href={
                          (session.role === "HR"
                            ? "/portal/imports"
                            : session.role === "DIRECTOR"
                              ? "/portal/approvals"
                              : "/portal/timesheets") as Route
                        }
                      >
                        Open workspace
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.sheets.length && (
              <p className={styles.empty}>
                No timesheets yet. Upload this period?s HR workbook to generate
                drafts.
              </p>
            )}
          </div>
          {["FINANCE", "HR"].includes(session.role) && (
            <section className={styles.panel}>
              <h2>Recent HR imports</h2>
              {data.imports.length ? (
                data.imports.map((item) => (
                  <p key={item.id}>
                    {item.filename} ? {item.summary.records} records ?{" "}
                    {new Date(item.createdAt).toLocaleString()}
                  </p>
                ))
              ) : (
                <p>
                  No HR workbook has been imported for this period. The seeded
                  sample records are available for demonstration.
                </p>
              )}
              <Link href={"/portal/imports" as Route}>
                Upload employee data
              </Link>
            </section>
          )}
        </>
      )}
    </div>
  );
}
const reportNames: Record<string, string> = {
  platform: "Business platform wise",
  hours: "Hours short / excess",
  headcount: "BG headcount",
  travel: "B1 travel",
  parameters: "Parameterized",
};
function Reports() {
  const { period, session, busy, execute } = usePortal();
  const { data: masters } = useData<Master[]>("masters");
  const [kind, setKind] = useState("platform");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [generatedQuery, setGeneratedQuery] = useState("");
  const change = (key: string, value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));
  const query = new URLSearchParams({ ...filters, kind, period }).toString();
  const select = (key: string, label: string, options: string[]) => (
    <label className={styles.field}>
      {label}
      <select
        value={filters[key] ?? ""}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value="">All</option>
        {options.map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
    </label>
  );
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Reports"
        description="Generate reports from saved timesheets within your authorized scope."
      />
      <div className={styles.tabs} role="group" aria-label="Report type">
        {Object.entries(reportNames).map(([key, label]) => (
          <Button
            key={key}
            variant={kind === key ? "primary" : "secondary"}
            aria-pressed={kind === key}
            onClick={() => {
              setKind(key);
              setRows(null);
              setFilters({});
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className={styles.panel}>
        <div className={styles.toolbar}>
          <MonthFilter />
          {select(
            "businessGroup",
            "Business group",
            masters
              ?.filter((m) => m.kind === "business-group")
              .map((m) => m.code) ?? [],
          )}
          {kind === "hours" &&
            select("hours", "Hours filter", ["below", "above"])}
          {["parameters", "platform"].includes(kind) &&
            select("platform", "Business platform", [
              ...new Set(
                masters
                  ?.filter((m) => m.kind === "business-group")
                  .map((m) => String(m.data.platform)),
              ),
            ])}
          {kind === "parameters" && (
            <>
              {select(
                "unit",
                "Business unit",
                [
                  ...new Set(
                    masters
                      ?.filter((m) => m.kind === "business-group")
                      .map((m) => String(m.data.unit ?? "")),
                  ),
                ].filter(Boolean),
              )}
              <label className={styles.field}>
                Employee code
                <input
                  value={filters.employeeCode ?? ""}
                  onChange={(e) => change("employeeCode", e.target.value)}
                />
              </label>
              {["from", "to"].map((key) => (
                <label className={styles.field} key={key}>
                  {key === "from" ? "From month" : "To month"}
                  <input
                    type="month"
                    value={filters[key] ?? period}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ))}
            </>
          )}
          {kind === "travel" && (
            <>
              <label className={styles.field}>
                US state
                <input
                  maxLength={2}
                  value={filters.usState ?? ""}
                  onChange={(e) =>
                    change("usState", e.target.value.toUpperCase())
                  }
                />
              </label>
              {["dateFrom", "dateTo"].map((key) => (
                <label className={styles.field} key={key}>
                  {key === "dateFrom" ? "Travel from" : "Travel to"}
                  <input
                    type="date"
                    value={filters[key] ?? ""}
                    onChange={(e) => change(key, e.target.value)}
                  />
                </label>
              ))}
            </>
          )}
          {["FINANCE", "DIRECTOR"].includes(session.role) &&
            ["platform", "parameters"].includes(kind) && (
              <label className={styles.field}>
                Include revenue
                <select
                  value={filters.revenue ?? "true"}
                  onChange={(e) => change("revenue", e.target.value)}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            )}
          <Button
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                setRows(await api<ReportRow[]>(`reports?${query}`));
                setGeneratedQuery(query);
              }, "Report generated.")
            }
          >
            Generate report
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !rows?.length || generatedQuery !== query}
            onClick={() =>
              void execute(
                () =>
                  download(
                    `reports/export?${generatedQuery}`,
                    `${kind}-${period}.xlsx`,
                  ),
                "Report downloaded.",
              )
            }
          >
            Export Excel
          </Button>
        </div>
      </div>
      {rows && generatedQuery !== query && (
        <Alert title="Filters changed">
          Generate the report again to apply the selected filters.
        </Alert>
      )}
      {rows ? (
        <ReportTable rows={rows} caption={reportNames[kind] ?? "Report"} />
      ) : (
        <p className={styles.muted}>Choose filters and generate the report.</p>
      )}
    </div>
  );
}
const masterFields: Record<
  string,
  { title: string; fields: [string, string, string][] }
> = {
  "business-group": {
    title: "Business groups",
    fields: [
      ["name", "Name", "text"],
      ["platform", "Business platform", "text"],
      ["unit", "Business unit", "text"],
      ["contribution", "Contribution %", "number"],
    ],
  },
  project: {
    title: "Project codes",
    fields: [
      ["description", "Description", "text"],
      ["businessGroup", "Business group", "text"],
    ],
  },
  "cost-center": {
    title: "Cost centers",
    fields: [
      ["name", "Name", "text"],
      ["businessGroup", "Business group", "text"],
      ["owner", "Owner", "text"],
      ["backCharging", "Back-charging enabled", "checkbox"],
    ],
  },
  rate: {
    title: "Rate card",
    fields: [
      ["rate", "Rate per hour (INR)", "number"],
      ["salaryMin", "Annual salary minimum", "number"],
      ["salaryMax", "Annual salary maximum", "number"],
    ],
  },
  fx: {
    title: "FX rates",
    fields: [
      ["usd", "INR per USD", "number"],
      ["eur", "INR per EUR", "number"],
    ],
  },
  cycle: {
    title: "Billing cycles",
    fields: [
      ["standardHours", "Standard hours", "number"],
      ["startDay", "Previous month start day", "number"],
      ["endDay", "Current month end day", "number"],
    ],
  },
};
function MasterForm({
  kind,
  initial,
  close,
}: {
  kind: string;
  initial: Master | null;
  close: () => void;
}) {
  const { busy, execute } = usePortal();
  const [code, setCode] = useState(initial?.code ?? "");
  const [data, setData] = useState<Master["data"]>(initial?.data ?? {});
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await api("masters", { kind, code, data });
          close();
        }, "Master data saved.");
      }}
    >
      <label className={styles.field}>
        {["fx", "cycle"].includes(kind) ? "Billing month" : "Code"}
        <input
          required
          type={["fx", "cycle"].includes(kind) ? "month" : "text"}
          value={code}
          readOnly={Boolean(initial)}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {masterFields[kind]?.fields.map(([key, label, type]) => (
        <label key={key} className={styles.field}>
          {label}
          {type === "checkbox" ? (
            <select
              value={String(data[key] ?? false)}
              onChange={(e) =>
                setData((d) => ({ ...d, [key]: e.target.value === "true" }))
              }
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          ) : (
            <input
              type={type}
              step="0.01"
              min="0"
              required={!["unit", "contribution"].includes(key)}
              maxLength={500}
              value={String(data[key] ?? "")}
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  [key]:
                    type === "number" ? Number(e.target.value) : e.target.value,
                }))
              }
            />
          )}
        </label>
      ))}
      {kind === "cycle" && (
        <p className={styles.muted}>
          Proration uses weekdays within the configured cycle. Calendar
          exceptions and public holidays require your organization?s policy.
        </p>
      )}
      <Button type="submit" disabled={busy}>
        Save record
      </Button>
    </form>
  );
}
function Masters() {
  const { busy, execute } = usePortal();
  const { data: masters, error } = useData<Master[]>("masters");
  const [kind, setKind] = useState("business-group");
  const [edit, setEdit] = useState<Master | null | undefined>(undefined);
  const records = masters?.filter((m) => m.kind === kind) ?? [];
  const config = masterFields[kind]!;
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Master data"
        description="Finance manages reference data, billing rates, and monthly cycle settings."
      />
      <div
        className={styles.tabs}
        role="group"
        aria-label="Master data category"
      >
        {Object.entries(masterFields).map(([key, value]) => (
          <Button
            key={key}
            variant={kind === key ? "primary" : "secondary"}
            aria-pressed={kind === key}
            onClick={() => setKind(key)}
          >
            {value.title}
          </Button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <Button onClick={() => setEdit(null)}>Add record</Button>
        <Button
          variant="secondary"
          disabled={busy || !records.length}
          onClick={() =>
            void execute(
              () => download(`masters/export?kind=${kind}`, `${kind}.xlsx`),
              "Master data downloaded.",
            )
          }
        >
          Export Excel
        </Button>
        {kind === "project" && (
          <label className={styles.field}>
            Import project workbook
            <input
              type="file"
              accept=".xlsx"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void execute(
                    async () => api("imports/projects", await fileBody(file)),
                    "Projects imported.",
                  );
                e.target.value = "";
              }}
            />
            <span>Columns: Project Code, Description, Business Group.</span>
          </label>
        )}
      </div>
      <DataState error={error} loading={!masters} />
      <div className={styles.table}>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              {config.fields.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td>{record.code}</td>
                {config.fields.map(([key]) => (
                  <td key={key}>{String(record.data[key] ?? "?")}</td>
                ))}
                <td>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => setEdit(record)}
                  >
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.length && masters && (
          <p className={styles.empty}>
            No records in this category. Add one to get started.
          </p>
        )}
      </div>
      <Dialog
        open={edit !== undefined}
        onOpenChange={(open) => {
          if (!open) setEdit(undefined);
        }}
      >
        <DialogContent
          title={`${edit ? "Edit" : "Add"} ${config.title.toLowerCase()}`}
          description="Changes are saved to the shared reference data."
        >
          {edit !== undefined && (
            <MasterForm
              key={edit?.id ?? kind}
              kind={kind}
              initial={edit}
              close={() => setEdit(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function AccessForm({ close }: { close: () => void }) {
  const { data: employees } = useData<Employee[]>("employees");
  const { busy, execute } = usePortal();
  const [code, setCode] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [centers, setCenters] = useState("");
  const [subject, setSubject] = useState("");
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        void execute(async () => {
          await api("access", {
            employeeCode: code,
            role,
            costCenters: centers
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
            oidcSubject: subject,
          });
          close();
        }, "Access granted.");
      }}
    >
      <label className={styles.field}>
        Employee
        <select required value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose an employee</option>
          {employees?.map((employee) => (
            <option key={employee.code} value={employee.code}>
              {employee.code} ? {employee.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {["MANAGER", "FINANCE", "HR", "DIRECTOR"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Cost centers (comma-separated)
        <input
          value={centers}
          required={role === "MANAGER"}
          onChange={(e) => setCenters(e.target.value)}
        />
      </label>
      <label className={styles.field}>
        Identity provider subject
        <input
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <span>
          Use the exact subject from the user?s organization sign-in account.
        </span>
      </label>
      <Button type="submit" disabled={busy}>
        Grant access
      </Button>
    </form>
  );
}
function UserAccess() {
  const { data: users, error } = useData<Access[]>("access");
  const { session, busy, execute } = usePortal();
  const [grant, setGrant] = useState(false);
  const [target, setTarget] = useState<Access | null>(null);
  return (
    <div className={styles.stack}>
      <PageHeader
        title="User access"
        description="Grant, revoke, and restore portal roles and cost center assignments."
        action={<Button onClick={() => setGrant(true)}>Grant access</Button>}
      />
      <DataState error={error} loading={!users} />
      <div className={styles.table}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Cost centers</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName}</td>
                <td>{user.email}</td>
                <td>{user.role}</td>
                <td>{user.costCenters.join(", ") || "Organization scope"}</td>
                <td>{user.active ? "Active" : "Revoked"}</td>
                <td>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={busy || user.id === session.id}
                    onClick={() => setTarget(user)}
                  >
                    {user.active ? "Revoke" : "Restore"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={grant} onOpenChange={setGrant}>
        <DialogContent
          title="Grant portal access"
          description="Assign an existing HR employee a role and identity provider subject."
        >
          <AccessForm close={() => setGrant(false)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent
          title={target?.active ? "Revoke access" : "Restore access"}
          description={`${target?.displayName ?? ""}: the change takes effect on their next request.`}
        >
          <Button
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                if (!target) return;
                await api(
                  `access/${target.id}`,
                  { active: !target.active },
                  "PATCH",
                );
                setTarget(null);
              }, "Access updated.")
            }
          >
            Confirm {target?.active ? "revoke" : "restore"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Imports() {
  const { period, busy, execute } = usePortal();
  const { data, error } = useData<Overview>(`overview?period=${period}`);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  return (
    <div className={styles.stack}>
      <PageHeader
        title="HR data upload"
        description="Import the monthly employee workbook and generate team timesheet drafts."
      />
      <div className={styles.toolbar}>
        <MonthFilter />
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void execute(
              () => download("imports/template", "hr-employee-template.xlsx"),
              "Template downloaded.",
            )
          }
        >
          Download HR template
        </Button>
      </div>
      <section
        className={styles.panel}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFile(e.dataTransfer.files[0] ?? null);
        }}
      >
        <h2>Employee workbook</h2>
        <label className={styles.field}>
          Choose or drop an Excel workbook
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className={styles.muted}>
          {file
            ? file.name
            : "Accepted: .xlsx, up to 6 MB. Use the downloaded template?s column names."}
        </p>
        <p>
          Supported tabs: All Employees, Transfer Resources, Contract Resources,
          Departures, Interns, Salary Change.
        </p>
        <Button
          disabled={busy || !file}
          onClick={() =>
            void execute(async () => {
              if (!file) return;
              setSummary(
                await api<ImportSummary>("imports/hr", {
                  period,
                  ...(await fileBody(file)),
                }),
              );
              setFile(null);
            }, "HR workbook imported.")
          }
        >
          Validate and import
        </Button>
      </section>
      <Alert title="Import behavior">
        Row errors stop the entire import. New joiners and departures are
        pro-rated; transfers split cost centers; travel splits US and non-US
        hours; billing grades follow configured salary bands. Submitted and
        approved timesheets remain unchanged.
      </Alert>
      {summary && (
        <section className={styles.panel}>
          <h2>Import results</h2>
          <p>
            {summary.records} records processed ? {summary.newEmployees} new
            employees ? {summary.transfers} transfers ? {summary.departures}{" "}
            departures
          </p>
          <p>
            {summary.generated} drafts generated or refreshed ? {summary.locked}{" "}
            locked timesheets skipped
          </p>
        </section>
      )}
      <DataState error={error} loading={!data} />
      {data && (
        <ReportTable
          caption="Import history"
          rows={data.imports.map((item) => ({
            File: item.filename,
            "Imported at": new Date(item.createdAt).toLocaleString(),
            Records: item.summary.records,
            "Drafts refreshed": item.summary.generated,
            "Locked / skipped": item.summary.locked,
          }))}
        />
      )}
    </div>
  );
}
function Notifications() {
  const { data, error } = useData<Notice[]>("notifications");
  const { busy, execute } = usePortal();
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Notifications"
        description="Workflow updates and reminders for your account."
      />
      <DataState error={error} loading={!data} />
      {data?.map((notice) => (
        <section key={notice.id} className={styles.panel}>
          <h2>{notice.title}</h2>
          <p>{notice.message}</p>
          <p className={styles.muted}>
            {new Date(notice.createdAt).toLocaleString()} ?{" "}
            {notice.read ? "Read" : "Unread"}
          </p>
          {!notice.read && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void execute(
                  () => api(`notifications/${notice.id}`, {}, "PATCH"),
                  "Notification marked as read.",
                )
              }
            >
              Mark as read
            </Button>
          )}
        </section>
      ))}
      {data?.length === 0 && <p>No notifications yet.</p>}
    </div>
  );
}
function AuditHistory() {
  const { data, error } = useData<Audit[]>("audit");
  return (
    <div className={styles.stack}>
      <PageHeader
        title="Audit history"
        description="Recent workflow, import, export, and access changes in your scope."
      />
      <DataState error={error} loading={!data} />
      {data && (
        <ReportTable
          caption="Latest 100 audit events"
          rows={data.map((event) => ({
            Time: new Date(event.createdAt).toLocaleString(),
            Action: event.action,
            Target: event.targetId,
            Summary: event.summary,
          }))}
        />
      )}
    </div>
  );
}
export function PortalScreen({ section }: { section: string }) {
  switch (section) {
    case "overview":
      return <Dashboard />;
    case "timesheets":
      return <Timesheets />;
    case "approvals":
      return <Approvals />;
    case "reports":
      return <Reports />;
    case "masters":
      return <Masters />;
    case "access":
      return <UserAccess />;
    case "imports":
      return <Imports />;
    case "notifications":
      return <Notifications />;
    case "audit":
      return <AuditHistory />;
    default:
      return (
        <Alert title="Page not found">
          <Link href={"/portal" as Route}>Return to overview</Link>
        </Alert>
      );
  }
}
