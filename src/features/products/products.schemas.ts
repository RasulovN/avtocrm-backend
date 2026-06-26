import { z } from 'zod';

// Django DRF products serializerlari ekvivalenti (zod).
// Decimal maydonlar string yoki number ko'rinishida kelishi mumkin — string'ga normalizatsiya qilinadi.

// ─────────────────────────────────────────────
// Category
// ─────────────────────────────────────────────

// CategorySerializer (CategoryCreateAPIView): name_uz (asosiy), + ru/en/uz_cyrl
export const categoryCreateSchema = z.object({
  name_uz: z.string().max(100),
  name_ru: z.string().max(100).nullable().optional(),
  name_en: z.string().max(100).nullable().optional(),
  name_uz_cyrl: z.string().max(100).nullable().optional(),
  // Tavsif majburiy emas — bo'sh bo'lsa '' saqlanadi
  description_uz: z.string().optional().default(''),
  description_ru: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  description_uz_cyrl: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});

// CategoryDetailSerializer (partial=True) — barcha maydon ixtiyoriy
export const categoryUpdateSchema = z.object({
  name_uz: z.string().max(100).optional(),
  name_ru: z.string().max(100).nullable().optional(),
  name_en: z.string().max(100).nullable().optional(),
  name_uz_cyrl: z.string().max(100).nullable().optional(),
  description_uz: z.string().optional(),
  description_ru: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
  description_uz_cyrl: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});

// ─────────────────────────────────────────────
// Brand
// ─────────────────────────────────────────────

// BrandSerializer: faqat `name` (validate_name service'da: trim + iexact uniqueness)
export const brandWriteSchema = z.object({
  name: z.string(),
});

// ─────────────────────────────────────────────
// Product
// ─────────────────────────────────────────────

// ProductCreateSerializer. barcode/sku ixtiyoriy (bo'sh -> avtomatik generatsiya).
// images route'da multipart fayllardan keladi — bu yerda emas.
export const productCreateSchema = z.object({
  category: z.number().int().nullable().optional(),
  brand: z.number().int().nullable().optional(),
  unit_measurement: z.number().int().nullable().optional(),
  name_uz: z.string().max(100),
  name_uz_cyrl: z.string().max(100).nullable().optional(),
  description_uz: z.string().optional().default(''),
  description_uz_cyrl: z.string().nullable().optional(),
  min_stock: z.number().int().min(0).optional().default(0),
  barcode: z.string().max(13).nullable().optional(),
  sku: z.string().max(64).nullable().optional(),
});

// ProductUpdateSerializer (partial=True). delete_image_ids — o'chiriladigan rasm IDlari.
// new_images — multipart fayllardan keladi (route'da).
export const productUpdateSchema = z.object({
  category: z.number().int().nullable().optional(),
  unit_measurement: z.number().int().nullable().optional(),
  name: z.string().max(100).optional(),
  description: z.string().optional(),
  min_stock: z.number().int().min(0).optional(),
  barcode: z.string().max(13).nullable().optional(),
  sku: z.string().max(64).nullable().optional(),
  delete_image_ids: z.array(z.number().int()).optional(),
});

// ─────────────────────────────────────────────
// Product batch location update (ProductBatchLocationUpdateSerializer)
// ─────────────────────────────────────────────

export const batchLocationUpdateSchema = z.object({
  location: z.number().int(),
});

// ─────────────────────────────────────────────
// Product location (ProductLocationSerializer)
// ─────────────────────────────────────────────

export const locationCreateSchema = z.object({
  location_uz: z.string(),
  location_uz_cyrl: z.string().nullable().optional(),
  location_ru: z.string().nullable().optional(),
  location_en: z.string().nullable().optional(),
  description_uz: z.string(),
  description_uz_cyrl: z.string().nullable().optional(),
  description_ru: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
});

export const locationUpdateSchema = z.object({
  location_uz: z.string().optional(),
  location_uz_cyrl: z.string().nullable().optional(),
  location_ru: z.string().nullable().optional(),
  location_en: z.string().nullable().optional(),
  description_uz: z.string().optional(),
  description_uz_cyrl: z.string().nullable().optional(),
  description_ru: z.string().nullable().optional(),
  description_en: z.string().nullable().optional(),
});

// ─────────────────────────────────────────────
// Unit measurement (ProductUnitMeasurementSerializer)
// ─────────────────────────────────────────────

export const measurementCreateSchema = z.object({
  measurement_uz: z.string().max(50),
  measurement_uz_cyrl: z.string().max(50).nullable().optional(),
  measurement_ru: z.string().max(50).nullable().optional(),
  measurement_en: z.string().max(50).nullable().optional(),
});

export const measurementUpdateSchema = z.object({
  measurement_uz: z.string().max(50).optional(),
  measurement_uz_cyrl: z.string().max(50).nullable().optional(),
  measurement_ru: z.string().max(50).nullable().optional(),
  measurement_en: z.string().max(50).nullable().optional(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;
export type BrandWriteInput = z.infer<typeof brandWriteSchema>;
export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
export type MeasurementCreateInput = z.infer<typeof measurementCreateSchema>;
export type MeasurementUpdateInput = z.infer<typeof measurementUpdateSchema>;
