-- AlterTable
ALTER TABLE "country" ADD COLUMN     "name_en" VARCHAR(150),
ADD COLUMN     "name_ru" VARCHAR(150),
ADD COLUMN     "name_uz_cyrl" VARCHAR(150);

-- AlterTable
ALTER TABLE "district" ADD COLUMN     "name_en" VARCHAR(150),
ADD COLUMN     "name_ru" VARCHAR(150),
ADD COLUMN     "name_uz_cyrl" VARCHAR(150);

-- AlterTable
ALTER TABLE "region" ADD COLUMN     "name_en" VARCHAR(150),
ADD COLUMN     "name_ru" VARCHAR(150),
ADD COLUMN     "name_uz_cyrl" VARCHAR(150);
