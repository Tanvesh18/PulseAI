-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'FINANCE';
ALTER TYPE "UserRole" ADD VALUE 'HR';
ALTER TYPE "UserRole" ADD VALUE 'DIRECTOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "costCenters" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "WorkforceEmployee" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "businessGroup" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "billingGrade" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "joinDate" TEXT NOT NULL,
    "exitDate" TEXT,
    "transferDate" TEXT,
    "previousCostCenter" TEXT,
    "annualSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "travelFrom" TEXT,
    "travelTo" TEXT,
    "usState" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Employee',

    CONSTRAINT "WorkforceEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessTimesheet" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "businessGroup" TEXT NOT NULL,
    "costCenter" TEXT NOT NULL,
    "managerUserId" TEXT NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "rows" JSONB NOT NULL,
    "submittedAt" TEXT,
    "reviewedAt" TEXT,
    "reviewerUserId" TEXT,
    "returnReason" TEXT,
    "exportedAt" TEXT,

    CONSTRAINT "BusinessTimesheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasterRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "MasterRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HRImport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HRImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkforceEmployee_organizationId_code_key" ON "WorkforceEmployee"("organizationId", "code");

-- CreateIndex
CREATE INDEX "BusinessTimesheet_organizationId_period_status_idx" ON "BusinessTimesheet"("organizationId", "period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessTimesheet_organizationId_period_costCenter_key" ON "BusinessTimesheet"("organizationId", "period", "costCenter");

-- CreateIndex
CREATE UNIQUE INDEX "MasterRecord_organizationId_kind_code_key" ON "MasterRecord"("organizationId", "kind", "code");
