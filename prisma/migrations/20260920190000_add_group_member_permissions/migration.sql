-- AlterTable
ALTER TABLE "GroupMember" ADD COLUMN "canManageOutings" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupMember" ADD COLUMN "canRecordPayments" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GroupMember" ADD COLUMN "canUseTemplates" BOOLEAN NOT NULL DEFAULT false;