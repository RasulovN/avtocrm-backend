-- CreateTable
CREATE TABLE "usage_daily" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "logins" INTEGER NOT NULL DEFAULT 0,
    "actions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "usage_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "usage_daily_date_idx" ON "usage_daily"("date");

-- CreateIndex
CREATE INDEX "usage_daily_user_id_date_idx" ON "usage_daily"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "usage_daily_company_id_user_id_date_key" ON "usage_daily"("company_id", "user_id", "date");

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: audit_log'dagi tarixiy login/yozuv amallaridan kunlik rollup.
-- requests = login + yozuv amallari (o'qish so'rovlari tarixda yo'q, shu sababli taxminiy).
INSERT INTO "usage_daily" (company_id, user_id, date, requests, logins, actions)
SELECT
  al.company_id,
  al.user_id,
  (al.created_at AT TIME ZONE 'Asia/Tashkent')::date AS date,
  COUNT(*)::int AS requests,
  (COUNT(*) FILTER (WHERE al.action = 'login'))::int AS logins,
  (COUNT(*) FILTER (WHERE al.action NOT IN ('login', 'logout')))::int AS actions
FROM "audit_log" al
JOIN "users_user" u ON u.id = al.user_id
JOIN "company" c ON c.id = al.company_id
WHERE al.company_id IS NOT NULL AND al.user_id IS NOT NULL
GROUP BY al.company_id, al.user_id, (al.created_at AT TIME ZONE 'Asia/Tashkent')::date
ON CONFLICT (company_id, user_id, date) DO NOTHING;
