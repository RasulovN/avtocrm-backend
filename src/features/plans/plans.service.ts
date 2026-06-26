import type { Plan, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import { pickLocalized, type Lang } from '../../common/i18n.js';
import type { PlanCreateInput, PlanUpdateInput } from './plans.schemas.js';

function decimalToString(value: Prisma.Decimal): string {
  return value.toString();
}

// Plan -> snake_case javob (Decimal -> string). name/description so'rov tiliga ko'ra,
// + RAW tarjima maydonlari admin forma uchun.
export function serializePlan(p: Plan, lang: Lang = 'uz') {
  return {
    id: p.id,
    name: pickLocalized(p, 'name', lang),
    description: pickLocalized(p, 'description', lang),
    // RAW variantlar (admin forma to'ldirish uchun)
    name_uz: p.name,
    name_ru: p.nameRu,
    name_en: p.nameEn,
    name_uz_cyrl: p.nameUzCyrl,
    description_uz: p.description,
    description_ru: p.descriptionRu,
    description_en: p.descriptionEn,
    description_uz_cyrl: p.descriptionUzCyrl,
    price: decimalToString(p.price),
    duration_days: p.durationDays,
    features: p.features ?? null,
    max_stores: p.maxStores,
    max_users: p.maxUsers,
    is_active: p.isActive,
    sort_order: p.sortOrder,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

// PUBLIC: faqat faol tariflar, sortOrder bo'yicha — kompaniya tanlovi uchun.
export async function listActivePlans(lang: Lang = 'uz') {
  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return plans.map((p) => serializePlan(p, lang));
}

// Super admin: barcha tariflar (nofaol ham).
export async function listAllPlans(lang: Lang = 'uz') {
  const plans = await prisma.plan.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return plans.map((p) => serializePlan(p, lang));
}

export async function getPlan(id: number): Promise<Plan> {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new NotFound({ detail: 'Tarif topilmadi.' });
  return plan;
}

export async function createPlan(data: PlanCreateInput, lang: Lang = 'uz') {
  const plan = await prisma.plan.create({
    data: {
      name: data.name,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      description: data.description ?? null,
      descriptionRu: data.description_ru ?? null,
      descriptionEn: data.description_en ?? null,
      descriptionUzCyrl: data.description_uz_cyrl ?? null,
      price: data.price,
      durationDays: data.duration_days,
      features: (data.features ?? undefined) as Prisma.InputJsonValue | undefined,
      maxStores: data.max_stores ?? null,
      maxUsers: data.max_users ?? null,
      isActive: data.is_active ?? true,
      sortOrder: data.sort_order ?? 0,
    },
  });
  return serializePlan(plan, lang);
}

export async function updatePlan(id: number, data: PlanUpdateInput, lang: Lang = 'uz') {
  await getPlan(id);
  const plan = await prisma.plan.update({
    where: { id },
    data: {
      name: data.name,
      nameRu: data.name_ru === undefined ? undefined : data.name_ru ?? null,
      nameEn: data.name_en === undefined ? undefined : data.name_en ?? null,
      nameUzCyrl: data.name_uz_cyrl === undefined ? undefined : data.name_uz_cyrl ?? null,
      description: data.description,
      descriptionRu: data.description_ru === undefined ? undefined : data.description_ru ?? null,
      descriptionEn: data.description_en === undefined ? undefined : data.description_en ?? null,
      descriptionUzCyrl:
        data.description_uz_cyrl === undefined ? undefined : data.description_uz_cyrl ?? null,
      price: data.price,
      durationDays: data.duration_days,
      features:
        data.features === undefined
          ? undefined
          : (data.features as Prisma.InputJsonValue),
      maxStores: data.max_stores,
      maxUsers: data.max_users,
      isActive: data.is_active,
      sortOrder: data.sort_order,
    },
  });
  return serializePlan(plan, lang);
}

// O'chirish: agar tarifga bog'langan obuna bo'lsa — FK himoyasi (400).
// Tavsiya: o'chirish o'rniga is_active=false qilish.
export async function deletePlan(id: number) {
  await getPlan(id);
  const linked = await prisma.subscription.count({ where: { planId: id } });
  if (linked > 0) {
    throw new BadRequest({
      detail:
        "Bu tarifga bog'langan obunalar mavjud. O'chirib bo'lmaydi. Buning o'rniga is_active=false qiling.",
    });
  }
  await prisma.plan.delete({ where: { id } });
}
