-- Obunaga oldindan to'langan oylar soni (1 | 3 | 6 | 12). Mavjud yozuvlar uchun standart 1.
ALTER TABLE "subscription" ADD COLUMN "period_months" INTEGER NOT NULL DEFAULT 1;
