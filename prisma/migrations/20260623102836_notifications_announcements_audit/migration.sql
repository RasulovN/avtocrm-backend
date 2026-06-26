-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "announcement_id" INTEGER,
ADD COLUMN     "link" VARCHAR(255),
ALTER COLUMN "company_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users_user" ADD COLUMN     "platform" VARCHAR(10) NOT NULL DEFAULT 'web';

-- CreateTable
CREATE TABLE "announcement" (
    "id" SERIAL NOT NULL,
    "created_by_id" INTEGER,
    "title" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "link" VARCHAR(255),
    "audience" VARCHAR(20) NOT NULL,
    "company_id" INTEGER,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "company_id" INTEGER,
    "action" VARCHAR(20) NOT NULL,
    "entity" VARCHAR(50),
    "entity_id" INTEGER,
    "summary" VARCHAR(255),
    "meta" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcement_audience_idx" ON "announcement"("audience");

-- CreateIndex
CREATE INDEX "audit_log_company_id_created_at_idx" ON "audit_log"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_user_id_created_at_idx" ON "audit_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_idx" ON "audit_log"("entity");

-- CreateIndex
CREATE INDEX "users_user_platform_idx" ON "users_user"("platform");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement" ADD CONSTRAINT "announcement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
