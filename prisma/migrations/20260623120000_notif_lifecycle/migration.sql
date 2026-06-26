-- DropForeignKey
ALTER TABLE "notification" DROP CONSTRAINT "notification_announcement_id_fkey";

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "archived_at" TIMESTAMP(3),
ADD COLUMN     "status" VARCHAR(10) NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "notification_user_id_status_idx" ON "notification"("user_id", "status");

-- CreateIndex
CREATE INDEX "notification_status_created_at_idx" ON "notification"("status", "created_at");

-- CreateIndex
CREATE INDEX "notification_status_archived_at_idx" ON "notification"("status", "archived_at");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

