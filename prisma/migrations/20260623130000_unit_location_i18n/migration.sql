-- AlterTable
ALTER TABLE "product_location" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "description_ru" TEXT,
ADD COLUMN     "location_en" TEXT,
ADD COLUMN     "location_ru" TEXT;

-- AlterTable
ALTER TABLE "product_unit_measurement" ADD COLUMN     "measurement_en" VARCHAR(50),
ADD COLUMN     "measurement_ru" VARCHAR(50);

