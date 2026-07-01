-- CreateTable
CREATE TABLE "payme_fiscal_receipt" (
    "id" SERIAL NOT NULL,
    "payme_receipt_id" VARCHAR(50) NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "transaction_id" INTEGER,
    "subscription_id" INTEGER,
    "receipt_id" VARCHAR(50),
    "terminal_id" VARCHAR(50),
    "fiscal_sign" VARCHAR(60),
    "qr_code_url" TEXT,
    "status_code" INTEGER,
    "message" TEXT,
    "fiscal_date" VARCHAR(50),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payme_fiscal_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payme_fiscal_receipt_subscription_id_idx" ON "payme_fiscal_receipt"("subscription_id");

-- CreateIndex
CREATE INDEX "payme_fiscal_receipt_transaction_id_idx" ON "payme_fiscal_receipt"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payme_fiscal_receipt_payme_receipt_id_type_key" ON "payme_fiscal_receipt"("payme_receipt_id", "type");

-- AddForeignKey
ALTER TABLE "payme_fiscal_receipt" ADD CONSTRAINT "payme_fiscal_receipt_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payme_transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
