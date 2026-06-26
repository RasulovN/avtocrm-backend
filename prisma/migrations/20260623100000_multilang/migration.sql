-- AlterTable
ALTER TABLE "category" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_ru" TEXT,
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "name_ru" TEXT;

-- AlterTable
ALTER TABLE "company_category" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_ru" TEXT,
ADD COLUMN     "description_uz_cyrl" TEXT,
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "name_ru" TEXT;

-- AlterTable
ALTER TABLE "plan" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_ru" TEXT,
ADD COLUMN     "description_uz_cyrl" TEXT,
ADD COLUMN     "name_en" TEXT,
ADD COLUMN     "name_ru" TEXT,
ADD COLUMN     "name_uz_cyrl" TEXT;

