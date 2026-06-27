-- CreateTable
CREATE TABLE "lead" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(50) NOT NULL,
    "email" VARCHAR(150) NOT NULL,
    "company" VARCHAR(150),
    "stores_range" VARCHAR(50),
    "message" TEXT,
    "source" VARCHAR(50) NOT NULL DEFAULT 'landing',
    "status" VARCHAR(20) NOT NULL DEFAULT 'new',
    "locale" VARCHAR(10),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_setting" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_status_created_at_idx" ON "lead"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "site_setting_key_key" ON "site_setting"("key");
