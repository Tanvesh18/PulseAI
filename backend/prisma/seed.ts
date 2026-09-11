import "dotenv/config";
import { seedPortal } from "./seed-portal";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { DemoData } from "../src/data/demo-data";

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo seed is disabled in production.");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const data = new DemoData();
  await prisma.$transaction(async (tx) => {
    // Re-running the seed never resets existing employee work.
    for (const user of data.users) await tx.user.upsert({ where: { id: user.id }, create: user, update: {} });
    for (const profile of data.profiles) await tx.employeeProfile.upsert({ where: { id: profile.id }, create: profile, update: {} });
    for (const assignment of data.assignments) await tx.assignment.upsert({ where: { id: assignment.id }, create: assignment, update: {} });
    for (const sheet of data.timesheets) await tx.timesheet.upsert({ where: { id: sheet.id }, create: sheet, update: {} });
    for (const notification of data.notifications) await tx.notification.upsert({ where: { id: notification.id }, create: notification, update: {} });
  }, { maxWait: 10000, timeout: 30000 });
  await seedPortal(prisma);
  console.log("Demo employee data seeded in PostgreSQL.");
}

main().catch((error: unknown) => {
  if (error && typeof error === "object" && "code" in error) console.error("Database error code:", error.code);
  console.error("Database seed failed. Check the connection and apply migrations first.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
