import type { Prisma, ProductLocation, ProductUnitMeasurement, User } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { Forbidden, NotFound, ValidationError } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { pickLang, type Lang } from '../../common/i18n.js';
import type {
  LocationCreateInput,
  LocationUpdateInput,
  MeasurementCreateInput,
  MeasurementUpdateInput,
} from './products.schemas.js';
import type { batchLocationUpdateSchema } from './products.schemas.js';

type BatchLocationUpdate = z.infer<typeof batchLocationUpdateSchema>;

function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

// ─────────────────────────────────────────────
// ProductBatchDetailView.put — Batch location yangilash
// (ProductBatchLocationUpdateSerializer: faqat location)
// ─────────────────────────────────────────────
export async function updateBatchLocation(pk: number, companyId: number, data: BatchLocationUpdate) {
  // Tenant-scope: batch shu company'ga tegishli bo'lishi shart
  const batch = await prisma.productBatch.findFirst({ where: { id: pk, companyId } });
  if (!batch) throw new NotFound();

  // location ham shu company'ga tegishli bo'lishini ta'minlaymiz
  const location = await prisma.productLocation.findFirst({
    where: { id: data.location, companyId },
    select: { id: true },
  });
  if (!location) throw new NotFound();

  const updated = await prisma.productBatch.update({
    where: { id: pk },
    data: { locationId: data.location },
  });
  return { location: updated.locationId };
}

// ─────────────────────────────────────────────
// ProductSearchAPIView — product name orqali qidirish + ranking + access control
// ─────────────────────────────────────────────

// ProductBatchSearchSerializer
function serializeBatchSearch(b: {
  id: number;
  productId: number;
  storeId: number;
  quantity: number;
  sellingPrice: Prisma.Decimal;
  locationId: number | null;
  product: { name: string; barcode: string | null; category: { name: string } | null };
  store: { name: string };
}) {
  return {
    id: b.id,
    product: b.productId,
    product_name: b.product.name,
    category_name: b.product.category?.name ?? null,
    store: b.storeId,
    store_name: b.store.name,
    quantity: b.quantity,
    selling_price: decimalToString(b.sellingPrice),
    // Django serializer `barcode`ni ProductBatch'dan oladi (modelda yo'q) — productdan beramiz.
    barcode: b.product.barcode,
    location: b.locationId,
  };
}

export async function searchProductsByName(productName: string, companyId: number, user: User) {
  // Tenant-scope: faqat shu company batchlari
  const where: Prisma.ProductBatchWhereInput = {
    companyId,
    isActive: true,
    product: { is: { status: 'a' } },
  };

  // ACCESS CONTROL: superuser bo'lmasa faqat o'z storelaridagi batchlar
  if (!user.isSuperuser) {
    const links = await prisma.storeUser.findMany({
      where: { userId: user.id, isActive: true },
      select: { storeId: true },
    });
    const storeIds = links.map((l) => l.storeId);
    if (storeIds.length === 0) {
      throw new Forbidden({ detail: "User store bilan bog'lanmagan" });
    }
    where.storeId = { in: storeIds };
  }

  const query = (productName ?? '').trim();
  if (query) {
    where.product = { is: { status: 'a', name: { contains: query, mode: 'insensitive' } } };
  }

  // Django: priority (iexact=3, istartswith=2, icontains=1) -> -priority, -created_at; limit 100.
  // Prisma'da ranking SQL'siz: avval 100 ta moslikni created_at desc oламиз, keyin JS'da rank qilamiz.
  const rows = await prisma.productBatch.findMany({
    where,
    select: {
      id: true,
      productId: true,
      storeId: true,
      quantity: true,
      sellingPrice: true,
      locationId: true,
      createdAt: true,
      product: { select: { name: true, barcode: true, category: { select: { name: true } } } },
      store: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: query ? 500 : 100,
  });

  let ranked = rows;
  if (query) {
    const lower = query.toLowerCase();
    const priority = (name: string): number => {
      const n = name.toLowerCase();
      if (n === lower) return 3;
      if (n.startsWith(lower)) return 2;
      if (n.includes(lower)) return 1;
      return 0;
    };
    ranked = [...rows]
      .sort((a, b) => {
        const pa = priority(a.product.name);
        const pb = priority(b.product.name);
        if (pa !== pb) return pb - pa;
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, 100);
  }

  return ranked.map(serializeBatchSearch);
}

// ─────────────────────────────────────────────
// ProductLocation CRUD (ProductLocationView / ProductLocationDetailView)
// ─────────────────────────────────────────────

// ProductLocationGetSerializer — so'rov tiliga ko'ra lokalizatsiya
function serializeLocationGet(l: ProductLocation, lang: Lang = 'uz') {
  return {
    id: l.id,
    location: pickLang(l.location, l.locationRu, l.locationEn, l.locationUzCyrl, lang),
    description: pickLang(l.description, l.descriptionRu, l.descriptionEn, l.descriptionUzCyrl, lang),
    created_at: l.createdAt,
  };
}

// ProductLocationSerializer — lokalizatsiya + barcha RAW translation maydonlari (forma uchun)
function serializeLocation(l: ProductLocation, lang: Lang = 'uz') {
  return {
    id: l.id,
    location: pickLang(l.location, l.locationRu, l.locationEn, l.locationUzCyrl, lang),
    description: pickLang(l.description, l.descriptionRu, l.descriptionEn, l.descriptionUzCyrl, lang),
    location_uz: l.location,
    location_uz_cyrl: l.locationUzCyrl,
    location_ru: l.locationRu,
    location_en: l.locationEn,
    description_uz: l.description,
    description_uz_cyrl: l.descriptionUzCyrl,
    description_ru: l.descriptionRu,
    description_en: l.descriptionEn,
    created_at: l.createdAt,
  };
}

function buildLocationOrdering(ordering?: string | null): Prisma.ProductLocationOrderByWithRelationInput {
  if (!ordering) return { location: 'asc' };
  const desc = ordering.startsWith('-');
  const field = desc ? ordering.slice(1) : ordering;
  const dir: Prisma.SortOrder = desc ? 'desc' : 'asc';
  if (field === 'created_at') return { createdAt: dir };
  if (field === 'location') return { location: dir };
  return { location: 'asc' };
}

export async function listLocations(opts: {
  companyId: number;
  search?: string | null;
  ordering?: string | null;
  page: PageParams;
  lang?: Lang;
}) {
  // Tenant-scope: faqat shu company joylashuvlari
  const where: Prisma.ProductLocationWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    // Barcha tillarda qidiramiz
    where.OR = [
      { location: { contains: opts.search, mode: 'insensitive' } },
      { locationUzCyrl: { contains: opts.search, mode: 'insensitive' } },
      { locationRu: { contains: opts.search, mode: 'insensitive' } },
      { locationEn: { contains: opts.search, mode: 'insensitive' } },
      { description: { contains: opts.search, mode: 'insensitive' } },
    ];
  }
  const [count, locations] = await prisma.$transaction([
    prisma.productLocation.count({ where }),
    prisma.productLocation.findMany({
      where,
      orderBy: buildLocationOrdering(opts.ordering),
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);
  const lang = opts.lang ?? 'uz';
  return { results: locations.map((l) => serializeLocationGet(l, lang)), count };
}

async function getLocationOr404(pk: number, companyId: number): Promise<ProductLocation> {
  const location = await prisma.productLocation.findFirst({ where: { id: pk, companyId } });
  if (!location) throw new NotFound();
  return location;
}

export async function getLocation(pk: number, companyId: number, lang: Lang = 'uz') {
  return serializeLocation(await getLocationOr404(pk, companyId), lang);
}

export async function createLocation(companyId: number, data: LocationCreateInput, lang: Lang = 'uz') {
  const location = await prisma.productLocation.create({
    data: {
      companyId, // tenant-scope
      location: data.location_uz,
      locationUzCyrl: data.location_uz_cyrl ?? null,
      locationRu: data.location_ru ?? null,
      locationEn: data.location_en ?? null,
      description: data.description_uz,
      descriptionUzCyrl: data.description_uz_cyrl ?? null,
      descriptionRu: data.description_ru ?? null,
      descriptionEn: data.description_en ?? null,
    },
  });
  // ProductLocationSerializer javobi
  return serializeLocation(location, lang);
}

export async function updateLocation(
  pk: number,
  companyId: number,
  data: LocationUpdateInput,
  lang: Lang = 'uz',
) {
  await getLocationOr404(pk, companyId);
  const updateData: Prisma.ProductLocationUpdateInput = {};
  if (data.location_uz !== undefined) updateData.location = data.location_uz;
  if (data.location_uz_cyrl !== undefined) updateData.locationUzCyrl = data.location_uz_cyrl;
  if (data.location_ru !== undefined) updateData.locationRu = data.location_ru;
  if (data.location_en !== undefined) updateData.locationEn = data.location_en;
  if (data.description_uz !== undefined) updateData.description = data.description_uz;
  if (data.description_uz_cyrl !== undefined) updateData.descriptionUzCyrl = data.description_uz_cyrl;
  if (data.description_ru !== undefined) updateData.descriptionRu = data.description_ru;
  if (data.description_en !== undefined) updateData.descriptionEn = data.description_en;
  const location = await prisma.productLocation.update({ where: { id: pk }, data: updateData });
  return serializeLocation(location, lang);
}

export async function deleteLocation(pk: number, companyId: number) {
  await getLocationOr404(pk, companyId);

  // ProductBatch.location onDelete: Restrict — bog'langan partiyalar bo'lsa o'chirib bo'lmaydi
  const used = await prisma.productBatch.findFirst({
    where: { locationId: pk, companyId },
    select: { id: true },
  });
  if (used) {
    throw new ValidationError({
      detail:
        "Bu joylashuvga bog'langan mahsulot partiyalari mavjud. Avval ularni boshqa joylashuvga ko'chiring yoki o'chiring!",
    });
  }

  await prisma.productLocation.delete({ where: { id: pk } });
}

// ─────────────────────────────────────────────
// ProductUnitMeasurement CRUD
// ─────────────────────────────────────────────

// ProductUnitMeasurementGetSerializer — so'rov tiliga ko'ra lokalizatsiya
function serializeMeasurementGet(m: ProductUnitMeasurement, lang: Lang = 'uz') {
  return {
    id: m.id,
    measurement: pickLang(m.measurement, m.measurementRu, m.measurementEn, m.measurementUzCyrl, lang),
  };
}

// ProductUnitMeasurementSerializer — lokalizatsiya + barcha RAW translation maydonlari
function serializeMeasurement(m: ProductUnitMeasurement, lang: Lang = 'uz') {
  return {
    id: m.id,
    measurement: pickLang(m.measurement, m.measurementRu, m.measurementEn, m.measurementUzCyrl, lang),
    measurement_uz: m.measurement,
    measurement_uz_cyrl: m.measurementUzCyrl,
    measurement_ru: m.measurementRu,
    measurement_en: m.measurementEn,
  };
}

export async function listMeasurements(companyId: number, lang: Lang = 'uz') {
  const measurements = await prisma.productUnitMeasurement.findMany({ where: { companyId } });
  return measurements.map((m) => serializeMeasurementGet(m, lang));
}

async function getMeasurementOr404(pk: number, companyId: number): Promise<ProductUnitMeasurement> {
  const m = await prisma.productUnitMeasurement.findFirst({ where: { id: pk, companyId } });
  if (!m) throw new NotFound();
  return m;
}

export async function getMeasurement(pk: number, companyId: number, lang: Lang = 'uz') {
  return serializeMeasurement(await getMeasurementOr404(pk, companyId), lang);
}

export async function createMeasurement(companyId: number, data: MeasurementCreateInput, lang: Lang = 'uz') {
  const m = await prisma.productUnitMeasurement.create({
    data: {
      companyId, // tenant-scope
      measurement: data.measurement_uz,
      measurementUzCyrl: data.measurement_uz_cyrl ?? null,
      measurementRu: data.measurement_ru ?? null,
      measurementEn: data.measurement_en ?? null,
    },
  });
  return serializeMeasurement(m, lang);
}

export async function updateMeasurement(
  pk: number,
  companyId: number,
  data: MeasurementUpdateInput,
  lang: Lang = 'uz',
) {
  await getMeasurementOr404(pk, companyId);
  const updateData: Prisma.ProductUnitMeasurementUpdateInput = {};
  if (data.measurement_uz !== undefined) updateData.measurement = data.measurement_uz;
  if (data.measurement_uz_cyrl !== undefined) updateData.measurementUzCyrl = data.measurement_uz_cyrl;
  if (data.measurement_ru !== undefined) updateData.measurementRu = data.measurement_ru;
  if (data.measurement_en !== undefined) updateData.measurementEn = data.measurement_en;
  const m = await prisma.productUnitMeasurement.update({ where: { id: pk }, data: updateData });
  return serializeMeasurement(m, lang);
}

export async function deleteMeasurement(pk: number, companyId: number) {
  await getMeasurementOr404(pk, companyId);
  await prisma.productUnitMeasurement.delete({ where: { id: pk } });
}

// ─────────────────────────────────────────────
// ProductBatchListAPIView — sotuv paneli uchun mahsulotlar ro'yxati
// (ProductBatchListSerializer: my_quantity / other_stores)
// ─────────────────────────────────────────────

// store resolver (ProductBatchListAPIView.get_store) — tenant-scope
async function resolveSelectedStore(user: User, companyId: number, storeIdParam?: string | null) {
  if (user.isSuperuser) {
    if (storeIdParam) {
      const store = await prisma.store.findFirst({
        where: { id: Number(storeIdParam), companyId },
      });
      if (!store) throw new NotFound();
      return store;
    }
    // default -> SKLAD (type='b')
    const base = await prisma.store.findFirst({ where: { companyId, type: 'b' } });
    if (!base) throw new NotFound();
    return base;
  }

  // SELLER: StoreUser orqali (faqat shu company do'koni)
  const link = await prisma.storeUser.findFirst({
    where: { userId: user.id, isActive: true, store: { is: { companyId } } },
    include: { store: true },
  });
  if (!link) throw new Forbidden({ detail: "User store bilan bog'lanmagan" });
  return link.store;
}

export async function listSalePanelProducts(opts: {
  user: User;
  companyId: number;
  storeIdParam?: string | null;
  search?: string | null;
}) {
  const selectedStore = await resolveSelectedStore(opts.user, opts.companyId, opts.storeIdParam);

  // Tenant-scope: faqat shu company mahsulotlari
  const where: Prisma.ProductWhereInput = { companyId: opts.companyId, status: 'a' };
  if (opts.search) {
    where.name = { contains: opts.search, mode: 'insensitive' };
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      batches: {
        where: { isActive: true },
        include: { store: { select: { name: true } } },
      },
    },
  });

  return products.map((p) => {
    let myQty = 0;
    const otherStores: Array<{ store_id: number; store_name: string; quantity: number }> = [];

    for (const b of p.batches) {
      if (b.storeId === selectedStore.id) {
        myQty = b.quantity;
      } else if (b.quantity > 0) {
        otherStores.push({
          store_id: b.storeId,
          store_name: b.store.name,
          quantity: b.quantity,
        });
      }
    }

    return {
      id: p.id,
      category: p.categoryId,
      name: p.name,
      unit_measurement: p.unitMeasurementId,
      description: p.description,
      my_quantity: myQty,
      // faqat o'z storeda yo'q bo'lsa boshqalarni ko'rsatamiz
      other_stores: myQty > 0 ? [] : otherStores,
    };
  });
}
