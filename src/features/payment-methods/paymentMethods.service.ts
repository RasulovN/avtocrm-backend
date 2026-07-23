import type { PaymentMethod, Prisma } from '@prisma/client';
import slugify from 'slugify';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import type {
  PaymentMethodCreateInput,
  PaymentMethodUpdateInput,
} from './paymentMethods.schemas.js';

// ─────────────────────────────────────────────
// Platforma darajasidagi to'lov turlari katalogi (super admin CRUD).
// POS'da "Karta" tanlanganda kanal sifatida ko'rsatiladi:
// Uzcard, Humo, Visa, Payme, Click, Uzum...
// ─────────────────────────────────────────────

// O'zbekistonda eng ko'p ishlatiladigan to'lov turlari — birinchi ishga
// tushishda (jadval bo'sh bo'lsa) avtomatik yaratiladi. Super admin keyin
// erkin tahrirlashi/o'chirishi mumkin — seed qayta yozmaydi.
const DEFAULT_METHODS: Array<{
  code: string;
  name: string;
  isDefault?: boolean;
  sortOrder: number;
}> = [
  { code: 'uzcard', name: 'Uzcard', isDefault: true, sortOrder: 1 },
  { code: 'humo', name: 'Humo', sortOrder: 2 },
  { code: 'visa', name: 'Visa', sortOrder: 3 },
  { code: 'mastercard', name: 'Mastercard', sortOrder: 4 },
  { code: 'payme', name: 'Payme', sortOrder: 5 },
  { code: 'click', name: 'Click', sortOrder: 6 },
  { code: 'uzum', name: 'Uzum Bank', sortOrder: 7 },
];

// ── Serializatsiya ────────────────────────────────────────

// POS (tenant) uchun — faqat kerakli maydonlar
function serializePublic(m: PaymentMethod) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    icon: m.icon,
    is_default: m.isDefault,
    scope: m.scope,
  };
}

// Super admin ro'yxati — to'liq + nechta to'lovda ishlatilgani
function serializeAdmin(m: PaymentMethod & { _count: { payments: number } }) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    icon: m.icon,
    is_active: m.isActive,
    is_default: m.isDefault,
    sort_order: m.sortOrder,
    scope: m.scope,
    payments_count: m._count.payments,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

// ── SEED ────────────────────────────────────────────────────

// Jadval bo'sh bo'lsa default to'lov turlarini yaratadi (server startida).
// Super admin o'chirgan yozuvlarni qayta tiklamaydi.
export async function seedDefaultPaymentMethods() {
  const count = await prisma.paymentMethod.count();
  if (count > 0) return;
  await prisma.paymentMethod.createMany({
    data: DEFAULT_METHODS.map((m) => ({
      code: m.code,
      name: m.name,
      isDefault: m.isDefault ?? false,
      sortOrder: m.sortOrder,
      isActive: true,
    })),
    skipDuplicates: true,
  });
}

// ── PUBLIC (POS) ───────────────────────────────────────────

// Faol to'lov turlari — sotuv/kirim sahifalarida karta kanali tanlash uchun.
// scope filtri: sale → scope in [sale, both]; purchase → scope in [purchase, both].
export async function listActivePaymentMethods(scope?: 'sale' | 'purchase' | null) {
  const where: Prisma.PaymentMethodWhereInput = { isActive: true };
  if (scope === 'sale' || scope === 'purchase') {
    where.scope = { in: [scope, 'both'] };
  }
  const methods = await prisma.paymentMethod.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  return methods.map(serializePublic);
}

// ── SUPER ADMIN ─────────────────────────────────────────────

export async function listAllPaymentMethods() {
  const methods = await prisma.paymentMethod.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { _count: { select: { payments: true } } },
  });
  return methods.map(serializeAdmin);
}

// Kod berilmasa nomdan slug yasaymiz, band bo'lsa raqamli suffix
async function generateUniqueCode(name: string, excludeId?: number): Promise<string> {
  const base = slugify(name, { lower: true, strict: true }) || 'method';
  let code = base.slice(0, 40);
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await prisma.paymentMethod.findUnique({ where: { code } });
    if (!existing || existing.id === excludeId) break;
    i += 1;
    code = `${base.slice(0, 36)}-${i}`;
  }
  return code;
}

export async function createPaymentMethod(data: PaymentMethodCreateInput) {
  const code = data.code ?? (await generateUniqueCode(data.name));
  const dup = await prisma.paymentMethod.findUnique({ where: { code } });
  if (dup) throw new BadRequest({ detail: "Bu kodli to'lov turi allaqachon mavjud." });

  return prisma.$transaction(async (tx) => {
    // Bitta default: yangi yozuv default bo'lsa, qolganlaridan belgini olamiz
    if (data.is_default) {
      await tx.paymentMethod.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }
    const method = await tx.paymentMethod.create({
      data: {
        code,
        name: data.name,
        icon: data.icon ?? null,
        isActive: data.is_active ?? true,
        isDefault: data.is_default ?? false,
        sortOrder: data.sort_order ?? 0,
        scope: data.scope ?? 'both',
      },
      include: { _count: { select: { payments: true } } },
    });
    return serializeAdmin(method);
  });
}

export async function updatePaymentMethod(id: number, data: PaymentMethodUpdateInput) {
  const existing = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: "To'lov turi topilmadi." });

  const updateData: Prisma.PaymentMethodUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.code !== undefined && data.code !== existing.code) {
    const dup = await prisma.paymentMethod.findUnique({ where: { code: data.code } });
    if (dup && dup.id !== id) throw new BadRequest({ detail: "Bu kodli to'lov turi allaqachon mavjud." });
    updateData.code = data.code;
  }
  if (data.icon !== undefined) updateData.icon = data.icon ?? null;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;
  if (data.is_default !== undefined) updateData.isDefault = data.is_default;
  if (data.sort_order !== undefined) updateData.sortOrder = data.sort_order;
  if (data.scope !== undefined) updateData.scope = data.scope;

  return prisma.$transaction(async (tx) => {
    if (data.is_default === true) {
      await tx.paymentMethod.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    const method = await tx.paymentMethod.update({
      where: { id },
      data: updateData,
      include: { _count: { select: { payments: true } } },
    });
    return serializeAdmin(method);
  });
}

// FK-himoya: to'lovlarda ishlatilgan turni o'chirib bo'lmaydi — nofaol qilish taklif etiladi
export async function deletePaymentMethod(id: number) {
  const existing = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: "To'lov turi topilmadi." });

  const paymentsCount = await prisma.payment.count({ where: { methodId: id } });
  if (paymentsCount > 0) {
    throw new BadRequest({
      detail: `Bu to'lov turi ${paymentsCount} ta to'lovda ishlatilgan. O'chirish o'rniga nofaol qiling.`,
    });
  }

  await prisma.paymentMethod.delete({ where: { id } });
}
