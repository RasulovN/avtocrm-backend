import type { Category, Prisma } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import slugify from 'slugify';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import type { PageParams } from '../../common/pagination.js';
import { pickLocalized, type Lang } from '../../common/i18n.js';
import { env } from '../../config/env.js';
import type { CategoryCreateInput, CategoryUpdateInput } from './products.schemas.js';
import type { UploadedImage } from './product.service.js';

const MAX_CATEGORY_IMAGE_SIZE = 5 * 1024 * 1024;

// Rasmni assets/media/categories/{slug}/ ga saqlaydi, DB uchun nisbiy yo'l qaytaradi
async function saveCategoryImage(image: UploadedImage, slug: string): Promise<string> {
  if (image.buffer.length > MAX_CATEGORY_IMAGE_SIZE) {
    throw new ValidationError({ image: ['Image size must be < 5MB'] });
  }
  const ext = extname(image.filename) || '.jpg';
  const safeName = `${randomUUID()}${ext}`;
  const relativePath = join('categories', slug || 'uncategorized', safeName).replace(/\\/g, '/');
  const absolutePath = join(process.cwd(), env.MEDIA_ROOT, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, image.buffer);
  return relativePath;
}

// DB'dagi nisbiy yo'lni frontend uchun URL'ga aylantiradi (/media/...)
function categoryImageUrl(image: string | null): string | null {
  if (!image) return null;
  if (/^https?:\/\//.test(image) || image.startsWith(env.MEDIA_URL)) return image;
  return `${env.MEDIA_URL}${image}`.replace(/([^:])\/\//g, '$1/');
}

// ─────────────────────────────────────────────
// Serializatsiya (DRF -> snake_case javob)
// ─────────────────────────────────────────────

// CategoryListSerializer — name/description so'rov tiliga ko'ra lokalizatsiya
export function serializeCategoryList(c: Category, lang: Lang = 'uz') {
  return {
    id: c.id,
    slug: c.slug,
    name: pickLocalized(c, 'name', lang),
    description: pickLocalized(c, 'description', lang),
    image: categoryImageUrl(c.image),
    created_at: c.createdAt,
  };
}

// CategorySerializer (create javobi) — lokalizatsiya + barcha RAW translation maydonlari
export function serializeCategory(c: Category, lang: Lang = 'uz') {
  return {
    id: c.id,
    name: pickLocalized(c, 'name', lang),
    description: pickLocalized(c, 'description', lang),
    name_uz: c.name,
    name_ru: c.nameRu,
    name_en: c.nameEn,
    name_uz_cyrl: c.nameUzCyrl,
    description_uz: c.description,
    description_ru: c.descriptionRu,
    description_en: c.descriptionEn,
    description_uz_cyrl: c.descriptionUzCyrl,
    image: categoryImageUrl(c.image),
  };
}

// CategoryDetailSerializer — slug + lokalizatsiya + barcha RAW translation maydonlari
export function serializeCategoryDetail(c: Category, lang: Lang = 'uz') {
  return {
    id: c.id,
    slug: c.slug,
    name: pickLocalized(c, 'name', lang),
    description: pickLocalized(c, 'description', lang),
    name_uz: c.name,
    name_ru: c.nameRu,
    name_en: c.nameEn,
    name_uz_cyrl: c.nameUzCyrl,
    description_uz: c.description,
    description_ru: c.descriptionRu,
    description_en: c.descriptionEn,
    description_uz_cyrl: c.descriptionUzCyrl,
    image: categoryImageUrl(c.image),
  };
}

// ─────────────────────────────────────────────
// CategoryListAPIView (search: name/description, ordering: name/created_at, default name)
// ─────────────────────────────────────────────
export async function listCategories(opts: {
  companyId: number;
  search?: string | null;
  ordering?: string | null;
  page: PageParams;
  lang?: Lang;
}) {
  // Tenant-scope: faqat shu company kategoriyalari
  const where: Prisma.CategoryWhereInput = { companyId: opts.companyId };
  if (opts.search) {
    where.OR = [
      { name: { contains: opts.search, mode: 'insensitive' } },
      { description: { contains: opts.search, mode: 'insensitive' } },
    ];
  }

  // ordering: name / -name / created_at / -created_at (default: name asc)
  const orderBy = buildOrdering(opts.ordering);

  const [count, categories] = await prisma.$transaction([
    prisma.category.count({ where }),
    prisma.category.findMany({
      where,
      orderBy,
      skip: opts.page.skip,
      take: opts.page.take,
    }),
  ]);

  const lang = opts.lang ?? 'uz';
  return { results: categories.map((c) => serializeCategoryList(c, lang)), count };
}

function buildOrdering(ordering?: string | null): Prisma.CategoryOrderByWithRelationInput {
  if (!ordering) return { name: 'asc' };
  const desc = ordering.startsWith('-');
  const field = desc ? ordering.slice(1) : ordering;
  const dir: Prisma.SortOrder = desc ? 'desc' : 'asc';
  if (field === 'created_at') return { createdAt: dir };
  if (field === 'name') return { name: dir };
  return { name: 'asc' };
}

// get_object_or_404 — tenant-scope: faqat shu company kategoriyasi
export async function getCategoryOr404(pk: number, companyId: number): Promise<Category> {
  const category = await prisma.category.findFirst({ where: { id: pk, companyId } });
  if (!category) throw new NotFound();
  return category;
}

export async function getCategoryDetail(pk: number, companyId: number, lang: Lang = 'uz') {
  return serializeCategoryDetail(await getCategoryOr404(pk, companyId), lang);
}

// ─────────────────────────────────────────────
// CategoryCreateAPIView.post — Category.save() slug = slugify(name)
// ─────────────────────────────────────────────
export async function createCategory(
  companyId: number,
  data: CategoryCreateInput,
  image?: UploadedImage | null,
  lang: Lang = 'uz',
) {
  const slug = slugify(data.name_uz, { lower: true, strict: true });
  const imagePath = image ? await saveCategoryImage(image, slug) : data.image ?? null;
  const category = await prisma.category.create({
    data: {
      companyId, // tenant-scope
      slug,
      name: data.name_uz,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      description: data.description_uz ?? '',
      descriptionRu: data.description_ru ?? null,
      descriptionEn: data.description_en ?? null,
      descriptionUzCyrl: data.description_uz_cyrl ?? null,
      image: imagePath,
    },
  });
  return serializeCategory(category, lang);
}

// ─────────────────────────────────────────────
// CategoryDetailAPIView.put (partial). name o'zgarsa slug qayta hisoblanadi.
// ─────────────────────────────────────────────
export async function updateCategory(
  pk: number,
  companyId: number,
  data: CategoryUpdateInput,
  image?: UploadedImage | null,
  lang: Lang = 'uz',
) {
  const existing = await getCategoryOr404(pk, companyId);

  const updateData: Prisma.CategoryUpdateInput = {};
  if (data.name_uz !== undefined) {
    updateData.name = data.name_uz;
    updateData.slug = slugify(data.name_uz, { lower: true, strict: true });
  }
  if (data.name_ru !== undefined) updateData.nameRu = data.name_ru;
  if (data.name_en !== undefined) updateData.nameEn = data.name_en;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl;
  if (data.description_uz !== undefined) updateData.description = data.description_uz;
  if (data.description_ru !== undefined) updateData.descriptionRu = data.description_ru;
  if (data.description_en !== undefined) updateData.descriptionEn = data.description_en;
  if (data.description_uz_cyrl !== undefined) updateData.descriptionUzCyrl = data.description_uz_cyrl;
  if (image) {
    const slug = (updateData.slug as string) ?? existing.slug;
    updateData.image = await saveCategoryImage(image, slug);
  } else if (data.image !== undefined) {
    updateData.image = data.image;
  }

  const category = await prisma.category.update({ where: { id: pk }, data: updateData });
  return serializeCategory(category, lang);
}

// ─────────────────────────────────────────────
// CategoryDetailAPIView.delete — ProtectedError (bog'langan productlar) -> 400
// ─────────────────────────────────────────────
export async function deleteCategory(pk: number, companyId: number) {
  await getCategoryOr404(pk, companyId);

  const used = await prisma.product.findFirst({
    where: { categoryId: pk, companyId },
    select: { id: true },
  });
  if (used) {
    throw new ValidationError({
      detail:
        "Bu categoryga bog'langan productlar mavjud. Avval ularni o'chiring yoki productni boshqa categoryga biriktiring!",
    });
  }

  await prisma.category.delete({ where: { id: pk } });
}
