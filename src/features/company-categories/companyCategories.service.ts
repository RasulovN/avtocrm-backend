import type { CompanyCategory, Prisma } from '@prisma/client';
import slugify from 'slugify';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import { mediaUrl } from '../../common/media.js';
import { pickLocalized, type Lang } from '../../common/i18n.js';
import type { CategoryCreateInput, CategoryUpdateInput } from './companyCategories.schemas.js';

// Nomdan noyob slug yaratadi (slugify + raqamli suffix kafolati).
// excludeId — yangilashda o'z yozuvini chetlab o'tish uchun.
async function generateUniqueSlug(name: string, excludeId?: number): Promise<string> {
  const base = slugify(name, { lower: true, strict: true }) || 'category';
  let slug = base;
  let i = 1;
  // Bo'sh emasligiga va boshqa yozuv egallamaganiga ishonch hosil qilamiz
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.companyCategory.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) break;
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}

// ── Serializatsiya ────────────────────────────────────────

// PUBLIC ro'yxat (onboarding'da tanlash uchun) — so'rov tiliga ko'ra lokalizatsiya
function serializePublic(c: CompanyCategory, lang: Lang) {
  return {
    id: c.id,
    name: pickLocalized(c, 'name', lang),
    slug: c.slug,
    icon: mediaUrl(c.icon),
    description: pickLocalized(c, 'description', lang),
  };
}

// Super admin ro'yxat — bog'langan kompaniyalar soni + RAW tarjima maydonlari (admin forma uchun)
function serializeAdmin(c: CompanyCategory & { _count: { companies: number } }, lang: Lang) {
  return {
    id: c.id,
    name: pickLocalized(c, 'name', lang),
    slug: c.slug,
    icon: mediaUrl(c.icon),
    description: pickLocalized(c, 'description', lang),
    // RAW variantlar (admin forma to'ldirish uchun)
    name_uz: c.name,
    name_ru: c.nameRu,
    name_en: c.nameEn,
    name_uz_cyrl: c.nameUzCyrl,
    description_uz: c.description,
    description_ru: c.descriptionRu,
    description_en: c.descriptionEn,
    description_uz_cyrl: c.descriptionUzCyrl,
    is_active: c.isActive,
    companies_count: c._count.companies,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

// ── PUBLIC ──────────────────────────────────────────────────

// Faol kategoriyalar ro'yxati (ro'yxatdan o'tgan har kim ko'radi)
export async function listActiveCategories(lang: Lang = 'uz') {
  const categories = await prisma.companyCategory.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return categories.map((c) => serializePublic(c, lang));
}

// ── SUPER ADMIN ─────────────────────────────────────────────

// Barcha kategoriyalar (nofaol ham), har birida kompaniyalar soni
export async function listAllCategories(lang: Lang = 'uz') {
  const categories = await prisma.companyCategory.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { companies: true } } },
  });
  return categories.map((c) => serializeAdmin(c, lang));
}

export async function createCategory(data: CategoryCreateInput, lang: Lang = 'uz') {
  // name unique (schema'da @unique) — oldindan tekshirib aniq xabar beramiz
  const dup = await prisma.companyCategory.findUnique({ where: { name: data.name } });
  if (dup) throw new BadRequest({ detail: 'Bu nomli kategoriya allaqachon mavjud.' });

  const slug = await generateUniqueSlug(data.name);
  const category = await prisma.companyCategory.create({
    data: {
      name: data.name,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      slug,
      description: data.description ?? null,
      descriptionRu: data.description_ru ?? null,
      descriptionEn: data.description_en ?? null,
      descriptionUzCyrl: data.description_uz_cyrl ?? null,
      icon: data.icon ?? null,
      isActive: data.is_active ?? true,
    },
    include: { _count: { select: { companies: true } } },
  });
  return serializeAdmin(category, lang);
}

export async function updateCategory(id: number, data: CategoryUpdateInput, lang: Lang = 'uz') {
  const existing = await prisma.companyCategory.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Kategoriya topilmadi.' });

  const updateData: Prisma.CompanyCategoryUpdateInput = {};
  if (data.name !== undefined && data.name !== existing.name) {
    const dup = await prisma.companyCategory.findUnique({ where: { name: data.name } });
    if (dup && dup.id !== id) throw new BadRequest({ detail: 'Bu nomli kategoriya allaqachon mavjud.' });
    updateData.name = data.name;
    // nom o'zgarsa slug qayta hisoblanadi
    updateData.slug = await generateUniqueSlug(data.name, id);
  }
  if (data.name_ru !== undefined) updateData.nameRu = data.name_ru ?? null;
  if (data.name_en !== undefined) updateData.nameEn = data.name_en ?? null;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl ?? null;
  if (data.description !== undefined) updateData.description = data.description ?? null;
  if (data.description_ru !== undefined) updateData.descriptionRu = data.description_ru ?? null;
  if (data.description_en !== undefined) updateData.descriptionEn = data.description_en ?? null;
  if (data.description_uz_cyrl !== undefined) updateData.descriptionUzCyrl = data.description_uz_cyrl ?? null;
  if (data.icon !== undefined) updateData.icon = data.icon ?? null;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  const category = await prisma.companyCategory.update({
    where: { id },
    data: updateData,
    include: { _count: { select: { companies: true } } },
  });
  return serializeAdmin(category, lang);
}

// FK-himoya: bog'langan kompaniya bo'lsa o'chirib bo'lmaydi
export async function deleteCategory(id: number) {
  const existing = await prisma.companyCategory.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Kategoriya topilmadi.' });

  const companyCount = await prisma.company.count({ where: { categoryId: id } });
  if (companyCount > 0) {
    throw new BadRequest({
      detail: `Bu kategoriyaga ${companyCount} ta kompaniya bog'langan. Avval ularni uzing yoki boshqa kategoriyaga o'tkazing.`,
    });
  }

  await prisma.companyCategory.delete({ where: { id } });
}
