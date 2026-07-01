-- Uzoq muddatga oldindan to'lov chegirmasi (foizda). 1 oy uchun chegirma yo'q.
ALTER TABLE "plan" ADD COLUMN "discount_m3" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plan" ADD COLUMN "discount_m6" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "plan" ADD COLUMN "discount_m12" INTEGER NOT NULL DEFAULT 0;
