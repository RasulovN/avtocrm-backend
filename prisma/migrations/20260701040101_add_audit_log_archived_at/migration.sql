-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "audit_log_archived_at_idx" ON "audit_log"("archived_at");
