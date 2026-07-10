import type { Plan, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import { pickLocalized, type Lang } from '../../common/i18n.js';
import type { PlanCreateInput, PlanUpdateInput } from './plans.schemas.js';
import { buildPricingOptions } from './plans.pricing.js';

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
    // Moslashuvchan tarif maydonlari
    is_custom: p.isCustom,
    base_price: decimalToString(p.basePrice),
    price_per_store: decimalToString(p.pricePerStore),
    price_per_user: decimalToString(p.pricePerUser),
    duration_days: p.durationDays,
    // Uzoq muddat chegirmalari (%)
    discount_3: p.discountM3,
    discount_6: p.discountM6,
    discount_12: p.discountM12,
    // Har bir muddat bo'yicha hisoblangan narx (frontend ko'rsatishi uchun)
    pricing: buildPricingOptions(p.price, p),
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
      isCustom: data.is_custom ?? false,
      basePrice: data.base_price ?? '0',
      pricePerStore: data.price_per_store ?? '0',
      pricePerUser: data.price_per_user ?? '0',
      durationDays: data.duration_days,
      discountM3: data.discount_3 ?? 0,
      discountM6: data.discount_6 ?? 0,
      discountM12: data.discount_12 ?? 0,
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
      isCustom: data.is_custom,
      basePrice: data.base_price,
      pricePerStore: data.price_per_store,
      pricePerUser: data.price_per_user,
      durationDays: data.duration_days,
      discountM3: data.discount_3,
      discountM6: data.discount_6,
      discountM12: data.discount_12,
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

// O'chirish qoidasi: tarifga FAOL obuna bo'lgan (kompaniya hozir foydalanayotgan)
// bo'lsa — o'chirib bo'lmaydi. Faol obuna bo'lmasa (barcha kompaniyalar boshqa tarifga
// o'tkazilgan / bekor qilingan) — tarif o'chiriladi. Tarixiy (bekor/tugagan/pending)
// obuna yozuvlari birga o'chadi; to'lov (PaymeTransaction) yozuvlari esa saqlanadi
// (schema'da subscriptionId onDelete=SetNull — to'lov tarixi yo'qolmaydi).
export async function deletePlan(id: number) {
  await getPlan(id);
  const now = new Date();
  const activeCount = await prisma.subscription.count({
    where: {
      planId: id,
      status: 'active',
      OR: [{ endAt: null }, { endAt: { gt: now } }],
    },
  });
  if (activeCount > 0) {
    throw new BadRequest({
      detail:
        "Bu tarifga faol obuna bo'lgan kompaniyalar bor. Avval ularni boshqa tarifga o'tkazing yoki obunani bekor qiling.",
      code: 'plan_has_active_subscriptions',
    });
  }
  // Faol obuna yo'q — tarixiy obunalarni (agar bo'lsa) va tarifni birga o'chiramiz.
  await prisma.$transaction(async (tx) => {
    await tx.subscription.deleteMany({ where: { planId: id } });
    await tx.plan.delete({ where: { id } });
  });
}
