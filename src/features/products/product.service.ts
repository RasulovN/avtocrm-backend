import type { Prisma, Product } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import { mediaUrl } from '../../common/media.js';
import { resolveImageExtension } from '../../common/uploads.js';
import type { PageParams } from '../../common/pagination.js';
import { env } from '../../config/env.js';
import { generateBarcodeImage, generateUniqueBarcode, normalizeBarcode } from './barcode.js';
import type { ProductCreateInput, ProductUpdateInput } from './products.schemas.js';
import { reevaluateProductLowStock } from '../inventory/lowStock.service.js';

const MAX_PRODUCT_IMAGES = 7;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

// ─────────────────────────────────────────────
// Yuklangan rasm fayli
// ─────────────────────────────────────────────
export interface UploadedImage {
  filename: string;
  buffer: Buffer;
}

// path_utility.product_image_path: products/{category_slug}/images/{filename}
async function saveProductImage(image: UploadedImage, categorySlug: string | null): Promise<string> {
  if (image.buffer.length > MAX_PRODUCT_IMAGE_SIZE) {
    throw new ValidationError({ images: ['Image size must be < 5MB'] });
  }
  const slug = categorySlug || 'uncategorized';
  // Kengaytmani foydalanuvchi nomidan emas, kontent (magic bytes) bo'yicha aniqlaymiz —
  // .html/.svg/.php orqali saqlangan XSS/RCE'ning oldini oladi.
  const ext = resolveImageExtension(image.buffer);
  const safeName = `${randomUUID()}${ext}`;
  const relativePath = join('products', slug, 'images', safeName).replace(/\\/g, '/');
  const absolutePath = join(process.cwd(), env.MEDIA_ROOT, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, image.buffer);
  return relativePath;
}

// ─────────────────────────────────────────────
// SKU generatsiya (Product.get_category_prefix + generate_sku)
//   prefix = kategoriya nomidagi so'zlar bosh harflari (yoki "PRD")
//   sku = {prefix}-{id:06d}
// ─────────────────────────────────────────────
function categoryPrefix(categoryName: string | null): string {
  if (!categoryName) return 'PRD';
  const words = categoryName.trim().split(/\s+/).filter(Boolean);
  const prefix = words.map((w) => w[0]!.toUpperCase()).join('');
  return prefix || 'PRD';
}

function generateSku(prefix: string, id: number): string {
  return `${prefix}-${String(id).padStart(6, '0')}`;
}

// ─────────────────────────────────────────────
// Serializatsiya
// ─────────────────────────────────────────────

// ProductImageSerializer
function serializeImage(img: { id: number; image: string }) {
  return { id: img.id, image: mediaUrl(img.image) };
}

// ProductListSerializer batches (barcha do'konlar bo'yicha — virtual yozuvlar bilan)
function serializeBatchesForStores(
  batches: Array<{
    id: number;
    storeId: number;
    locationId: number | null;
    location: { location: string } | null;
    quantity: number;
    purchasePrice: Prisma.Decimal;
    sellingPrice: Prisma.Decimal;
    wholesalePrice: Prisma.Decimal;
    isActive: boolean;
  }>,
  allStores: Array<{ id: number; name: string }>,
) {
  const batchMap = new Map<number, (typeof batches)[number]>();
  for (const b of batches) batchMap.set(b.storeId, b);

  return allStores.map((store) => {
    const b = batchMap.get(store.id);
    if (b) {
      return {
        id: b.id,
        store: b.storeId,
        store_name: store.name,
        location: b.locationId,
        location_name: b.location?.location ?? null,
        quantity: b.quantity,
        purchase_price: decimalToString(b.purchasePrice),
        selling_price: decimalToString(b.sellingPrice),
        wholesale_price: decimalToString(b.wholesalePrice),
        is_active: b.isActive,
      };
    }
    // virtual yozuv (batch yo'q)
    return {
      id: null,
      store: store.id,
      store_name: store.name,
      location: null,
      location_name: null,
      quantity: 0,
      purchase_price: null,
      selling_price: null,
      wholesale_price: null,
      is_active: null,
    };
  });
}

// ─────────────────────────────────────────────
// ProductListAPIView — status=ACTIVE, search, category/is_active filter, pagination
// ─────────────────────────────────────────────
export async function listProducts(opts: {
  companyId: number;
  search?: string | null;
  category?: number | null;
  isActive?: string | null;
  archived?: boolean;
  // lite=true — katalog (kirim/transfer dialoglari) uchun yengil javob:
  // rasmlar yuklanmaydi (katta ro'yxatlarda payload sezilarli kichrayadi)
  lite?: boolean;
  page: PageParams;
}) {
  // Tenant-scope: faqat shu company mahsulotlari.
  // archived=true — faqat arxivdagilar; aks holda arxivlanmaganlar (faol+nofaol) ko'rinadi,
  // shunda ro'yxatda nofaol mahsulotni qayta faollashtirish mumkin bo'ladi.
  const where: Prisma.ProductWhereInput = {
    companyId: opts.companyId,
    archivedAt: opts.archived ? { not: null } : null,
  };

  if (opts.category != null) {
    where.categoryId = opts.category;
  }
  // ProductFilter.is_active — modelda is_active maydoni yo'q; status bo'yicha izohlanadi.
  if (opts.isActive != null) {
    const active = opts.isActive.toLowerCase() === 'true';
    where.status = active ? 'a' : { not: 'a' };
  }

  // SearchFilter: id, name, sku, barcode, description
  if (opts.search) {
    const s = opts.search;
    const or: Prisma.ProductWhereInput[] = [
      { name: { contains: s, mode: 'insensitive' } },
      { sku: { contains: s, mode: 'insensitive' } },
      { barcode: { contains: s, mode: 'insensitive' } },
      { description: { contains: s, mode: 'insensitive' } },
    ];
    if (/^\d+$/.test(s)) or.push({ id: Number(s) });
    where.OR = or;
  }

  const [count, products, allStores] = await prisma.$transaction([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      skip: opts.page.skip,
      take: opts.page.take,
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        unitMeasurement: { select: { measurement: true } },
        // lite rejimda rasmlar bo'sh qaytadi (take: 0 — shape o'zgarmaydi)
        images: { select: { id: true, image: true }, ...(opts.lite ? { take: 0 } : {}) },
        batches: {
          where: { isActive: true },
          include: { location: { select: { location: true } } },
        },
      },
    }),
    prisma.store.findMany({
      where: { companyId: opts.companyId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const results = products.map((p) => ({
    id: p.id,
    category: p.categoryId,
    category_name: p.category?.name ?? null,
    brand: p.brandId,
    brand_name: p.brand?.name ?? null,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    shtrix_code: mediaUrl(p.shtrixCode),
    unit_measurement: p.unitMeasurementId,
    unit_measurement_name: p.unitMeasurement?.measurement ?? null,
    description: p.description,
    min_stock: p.minStock,
    status: p.status,
    is_active: p.status === 'a',
    archived_at: p.archivedAt,
    created_at: p.createdAt,
    images: p.images.map(serializeImage),
    batches: serializeBatchesForStores(p.batches, allStores),
  }));

  return { results, count };
}

// ─────────────────────────────────────────────
// get_object_or_404
// ─────────────────────────────────────────────
async function getProductOr404(pk: number, companyId: number): Promise<Product> {
  const product = await prisma.product.findFirst({ where: { id: pk, companyId } });
  if (!product) throw new NotFound();
  return product;
}

// ProductDetailAPIView.get — ProductUpdateSerializer fields
export async function getProductDetail(pk: number, companyId: number) {
  const p = await prisma.product.findFirst({
    where: { id: pk, companyId },
    include: { images: { select: { id: true, image: true } } },
  });
  if (!p) throw new NotFound();
  return {
    id: p.id,
    category: p.categoryId,
    unit_measurement: p.unitMeasurementId,
    name: p.name,
    description: p.description,
    min_stock: p.minStock,
    barcode: p.barcode,
    sku: p.sku,
    is_active: p.status === 'a',
    archived_at: p.archivedAt,
    images: p.images.map(serializeImage),
  };
}

function validateUploadedImages(images: UploadedImage[], field = 'images'): void {
  if (images.length > MAX_PRODUCT_IMAGES) {
    throw new ValidationError({ [field]: ['Ko‘pi bilan 7 ta rasm yuklash mumkin.'] });
  }
  for (const image of images) {
    if (image.buffer.length > MAX_PRODUCT_IMAGE_SIZE) {
      throw new ValidationError({ [field]: ['Har bir rasm hajmi 5 MB dan kichik bo‘lishi kerak.'] });
    }
    resolveImageExtension(image.buffer);
  }
}

// ─────────────────────────────────────────────
// validate_barcode / validate_sku (ProductCreate/Update serializer)
// ─────────────────────────────────────────────
async function resolveBarcode(
  raw: string | null | undefined,
  companyId: number,
  excludeId?: number,
): Promise<string | null> {
  if (!raw) return null;
  let fullCode: string;
  try {
    fullCode = normalizeBarcode(raw);
  } catch {
    throw new ValidationError({
      barcode: ["Barcode yaroqli EAN-13 formatda bo'lishi kerak (12-13 raqam)."],
    });
  }
  // Uniqueness tenant doirasida (barcode @@unique([companyId, barcode]))
  const existing = await prisma.product.findFirst({
    where: { companyId, barcode: fullCode, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError({ barcode: ['Bu barcode allaqachon mavjud.'] });
  }
  return fullCode;
}

async function resolveSku(
  raw: string | null | undefined,
  companyId: number,
  excludeId?: number,
): Promise<string | null> {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  // Uniqueness tenant doirasida (sku @@unique([companyId, sku]))
  const existing = await prisma.product.findFirst({
    where: { companyId, sku: value, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError({ sku: ['Bu SKU allaqachon mavjud.'] });
  }
  return value;
}

// ─────────────────────────────────────────────
// ProductCreateAPIView -> ProductService.create_product
//   Django: create -> save() ichida SKU + barcode + shtrix rasm avtomatik.
//   Prisma: create -> id olingach update bilan ko'chiriladi.
// ─────────────────────────────────────────────
export async function createProduct(
  companyId: number,
  data: ProductCreateInput,
  images: UploadedImage[],
) {
  validateUploadedImages(images);

  // barcode/sku validatsiya (kelmasa null -> avtomatik) — tenant doirasida
  const barcode = await resolveBarcode(data.barcode, companyId);
  const manualSku = await resolveSku(data.sku, companyId);

  // kategoriya prefiksi va slug uchun kategoriya nomi/slug kerak (tenant-scope)
  let categoryName: string | null = null;
  let categorySlug: string | null = null;
  if (data.category != null) {
    const cat = await prisma.category.findFirst({
      where: { id: data.category, companyId },
      select: { name: true, slug: true },
    });
    categoryName = cat?.name ?? null;
    categorySlug = cat?.slug ?? null;
  }

  const created = await prisma.product.create({
    data: {
      companyId, // tenant-scope
      categoryId: data.category ?? null,
      brandId: data.brand ?? null,
      unitMeasurementId: data.unit_measurement ?? null,
      name: data.name_uz,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      description: data.description_uz ?? '',
      descriptionUzCyrl: data.description_uz_cyrl ?? null,
      minStock: data.min_stock ?? 0,
      barcode,
      sku: manualSku,
    },
  });

  // save() post-create: SKU (qo'lda kelmasa), barcode (qo'lda kelmasa), shtrix rasm
  const finalBarcode = barcode ?? (await generateUniqueBarcode(companyId));
  const finalSku = manualSku ?? generateSku(categoryPrefix(categoryName), created.id);
  const shtrixPath = await generateBarcodeImage(finalBarcode, categorySlug);

  await prisma.product.update({
    where: { id: created.id },
    data: { sku: finalSku, barcode: finalBarcode, shtrixCode: shtrixPath },
  });

  // rasmlar
  if (images.length > 0) {
    const imageRows: Prisma.ProductImageCreateManyInput[] = [];
    for (const img of images) {
      const path = await saveProductImage(img, categorySlug);
      imageRows.push({ productId: created.id, image: path });
    }
    await prisma.productImage.createMany({ data: imageRows });
  }

  return getProductDetail(created.id, companyId);
}

// ─────────────────────────────────────────────
// ProductDetailAPIView.put -> ProductUpdateSerializer.update
//   product fields + barcode/sku (qo'lda) + new_images + delete_image_ids
// ─────────────────────────────────────────────
export async function updateProduct(
  pk: number,
  companyId: number,
  data: ProductUpdateInput,
  newImages: UploadedImage[],
) {
  const product = await getProductOr404(pk, companyId);

  validateUploadedImages(newImages, 'new_images');
  const remainingImageCount = await prisma.productImage.count({
    where: {
      productId: pk,
      ...(data.delete_image_ids?.length ? { id: { notIn: data.delete_image_ids } } : {}),
    },
  });
  if (remainingImageCount + newImages.length > MAX_PRODUCT_IMAGES) {
    throw new ValidationError({ new_images: ['Mahsulotda jami ko‘pi bilan 7 ta rasm bo‘lishi mumkin.'] });
  }

  const updateData: Prisma.ProductUpdateInput = {};
  if (data.category !== undefined) updateData.category = data.category ? { connect: { id: data.category } } : { disconnect: true };
  if (data.unit_measurement !== undefined)
    updateData.unitMeasurement = data.unit_measurement
      ? { connect: { id: data.unit_measurement } }
      : { disconnect: true };
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.min_stock !== undefined) updateData.minStock = data.min_stock;
  // Faol/nofaol holat: is_active -> status ('a'/'i')
  if (data.is_active !== undefined) updateData.status = data.is_active ? 'a' : 'i';

  // kategoriya slug (rasm/shtrix yo'li uchun)
  const categoryId = data.category !== undefined ? data.category : product.categoryId;
  let categorySlug: string | null = null;
  if (categoryId != null) {
    const cat = await prisma.category.findFirst({
      where: { id: categoryId, companyId },
      select: { slug: true },
    });
    categorySlug = cat?.slug ?? null;
  }

  // barcode qo'lda o'zgartirilsa — yangilanadi va shtrix rasm qayta yaratiladi
  const newBarcode = await resolveBarcode(data.barcode, companyId, product.id);
  if (newBarcode && newBarcode !== product.barcode) {
    updateData.barcode = newBarcode;
    updateData.shtrixCode = await generateBarcodeImage(newBarcode, categorySlug);
  }

  // sku qo'lda o'zgartirilsa
  const newSku = await resolveSku(data.sku, companyId, product.id);
  if (newSku) {
    updateData.sku = newSku;
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: pk }, data: updateData });
    if (data.min_stock !== undefined && data.min_stock !== product.minStock) {
      await reevaluateProductLowStock({ product: pk, db: tx });
    }

    // DELETE IMAGES (DB rowlar; fayllar diskda qoldiriladi — best-effort)
    if (data.delete_image_ids && data.delete_image_ids.length > 0) {
      await tx.productImage.deleteMany({
        where: { id: { in: data.delete_image_ids }, productId: pk },
      });
    }

    // ADD NEW IMAGES
    if (newImages.length > 0) {
      const rows: Prisma.ProductImageCreateManyInput[] = [];
      for (const img of newImages) {
        const path = await saveProductImage(img, categorySlug);
        rows.push({ productId: pk, image: path });
      }
      await tx.productImage.createMany({ data: rows });
    }
  });

  return getProductDetail(pk, companyId);
}

// ─────────────────────────────────────────────
// O'chirish (soft-delete) — mahsulot arxivga tushadi, 30 kundan keyin
// scheduler job butunlay o'chiradi. Arxivdagilar ro'yxat/sotuv panelida chiqmaydi.
// ─────────────────────────────────────────────
export async function archiveProduct(pk: number, companyId: number) {
  const product = await getProductOr404(pk, companyId);
  if (product.archivedAt) return; // allaqachon arxivda
  await prisma.product.update({ where: { id: pk }, data: { archivedAt: new Date() } });
}

// Arxivdan tiklash — archivedAt tozalanadi, status o'z holicha qoladi
export async function restoreProduct(pk: number, companyId: number) {
  await getProductOr404(pk, companyId);
  await prisma.product.update({ where: { id: pk }, data: { archivedAt: null } });
}

// ─────────────────────────────────────────────
// Bulk amallar — ro'yxatda checkbox orqali tanlangan mahsulotlar uchun
// ─────────────────────────────────────────────

// Tanlangan (faol) mahsulotlarni birdaniga arxivlash. Tenant scope: faqat
// shu company mahsulotlari; allaqachon arxivda bo'lganlar o'tkazib yuboriladi.
export async function bulkArchiveProducts(companyId: number, ids: number[]): Promise<number> {
  const result = await prisma.product.updateMany({
    where: { id: { in: ids }, companyId, archivedAt: null },
    data: { archivedAt: new Date() },
  });
  return result.count;
}

// Tanlangan mahsulotlarni arxivdan birdaniga tiklash
export async function bulkRestoreProducts(companyId: number, ids: number[]): Promise<number> {
  const result = await prisma.product.updateMany({
    where: { id: { in: ids }, companyId, archivedAt: { not: null } },
    data: { archivedAt: null },
  });
  return result.count;
}

export interface BulkDeleteResult {
  deleted: number;
  // Kirim/sotuvda ishlatilgani uchun o'chirib bo'lmaganlar (arxivlash mumkin)
  skipped: Array<{ id: number; name: string }>;
}

// Tanlanganlarni butunlay o'chirish: Restrict-bog'liqligi borlar (kirim/sotuv/
// qaytarim/transfer/spisaniye) o'chirilmaydi — skipped ro'yxatida qaytariladi.
export async function bulkDeleteProducts(companyId: number, ids: number[]): Promise<BulkDeleteResult> {
  const products = await prisma.product.findMany({
    where: { id: { in: ids }, companyId },
    select: { id: true, name: true },
  });
  const ownIds = products.map((p) => p.id);
  if (ownIds.length === 0) return { deleted: 0, skipped: [] };

  // Har jadvaldan ishlatilgan productId'lar (distinct) — bitta so'rovdan yig'iladi
  const [entryUsed, saleUsed, returnUsed, transferUsed, writeOffUsed] = await prisma.$transaction([
    prisma.stockEntryItem.findMany({
      where: { productId: { in: ownIds } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.saleItem.findMany({
      where: { productId: { in: ownIds } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.saleReturnItem.findMany({
      where: { productId: { in: ownIds } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.stockTransferItem.findMany({
      where: { productId: { in: ownIds } },
      select: { productId: true },
      distinct: ['productId'],
    }),
    prisma.writeOffItem.findMany({
      where: { productId: { in: ownIds } },
      select: { productId: true },
      distinct: ['productId'],
    }),
  ]);
  const usedIds = new Set(
    [...entryUsed, ...saleUsed, ...returnUsed, ...transferUsed, ...writeOffUsed].map((r) => r.productId),
  );

  const deletableIds = ownIds.filter((id) => !usedIds.has(id));
  if (deletableIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: deletableIds }, companyId } });
  }

  return {
    deleted: deletableIds.length,
    skipped: products.filter((p) => usedIds.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
  };
}

// ─────────────────────────────────────────────
// Butunlay o'chirish — ProtectedError -> 400
// ─────────────────────────────────────────────
export async function deleteProduct(pk: number, companyId: number) {
  await getProductOr404(pk, companyId);

  // Restrict-bog'liqlik tekshiruvi (StockEntryItem, SaleItem, va h.k. -> onDelete: Restrict)
  const [entryUsed, saleUsed, returnUsed, transferUsed, writeOffUsed] = await prisma.$transaction([
    prisma.stockEntryItem.findFirst({ where: { productId: pk }, select: { id: true } }),
    prisma.saleItem.findFirst({ where: { productId: pk }, select: { id: true } }),
    prisma.saleReturnItem.findFirst({ where: { productId: pk }, select: { id: true } }),
    prisma.stockTransferItem.findFirst({ where: { productId: pk }, select: { id: true } }),
    prisma.writeOffItem.findFirst({ where: { productId: pk }, select: { id: true } }),
  ]);
  if (entryUsed || saleUsed || returnUsed || transferUsed || writeOffUsed) {
    throw new ValidationError(
      "Bu mahsulotni butunlay o'chirib bo'lmaydi, chunki u allaqachon tizimda ishlatilgan (kirim/sotuv mavjud). Uni arxivlash mumkin.",
    );
  }

  await prisma.product.delete({ where: { id: pk } });
}
