import type { Company, Prisma, User } from '@prisma/client';
import slugify from 'slugify';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import { mediaUrl } from '../../common/media.js';
import { provisionOwnerRole } from '../rbac/rbac.service.js';
import type { OnboardingInput, ProfileUpdateInput, StatusUpdateInput } from './companies.schemas.js';
import type { PageParams } from '../../common/pagination.js';

// Tranzaksiya kliyenti yoki oddiy prisma kliyenti (slug uniqueness uchun)
type Db = Prisma.TransactionClient | typeof prisma;

// Decimal -> string (null bo'lsa null)
function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

// Nomdan noyob slug yaratadi (slugify + raqamli suffix kafolati).
async function generateUniqueSlug(db: Db, name: string, excludeId?: number): Promise<string> {
  const base = slugify(name, { lower: true, strict: true }) || 'company';
  let slug = base;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await db.company.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) break;
    i += 1;
    slug = `${base}-${i}`;
  }
  return slug;
}

// Faol obuna holatini hisoblaydi
function computeSubscriptionActive(
  subscriptions: { status: string; endAt: Date | null }[],
): boolean {
  const now = Date.now();
  return subscriptions.some(
    (s) => s.status === 'active' && (!s.endAt || s.endAt.getTime() > now),
  );
}

// ── Includelar ───────────────────────────────────────────────

const fullInclude = {
  category: true,
  country: true,
  region: true,
  district: true,
  owner: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
  subscriptions: { where: { status: 'active' }, select: { status: true, endAt: true } },
} satisfies Prisma.CompanyInclude;

type CompanyFull = Prisma.CompanyGetPayload<{ include: typeof fullInclude }>;

const listInclude = {
  category: { select: { id: true, name: true } },
  country: { select: { id: true, name: true } },
  region: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  owner: { select: { id: true, fullName: true, phoneNumber: true, email: true } },
  subscriptions: { where: { status: 'active' }, select: { status: true, endAt: true } },
  _count: { select: { users: true } },
} satisfies Prisma.CompanyInclude;

type CompanyListItem = Prisma.CompanyGetPayload<{ include: typeof listInclude }>;

// ── Serializatsiya ────────────────────────────────────────────

// To'liq profil (GET /me/, GET /:id/)
function serializeFull(c: CompanyFull) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    owner: c.owner
      ? {
          id: c.owner.id,
          full_name: c.owner.fullName,
          phone_number: c.owner.phoneNumber,
          email: c.owner.email,
        }
      : null,
    category: c.category ? { id: c.category.id, name: c.category.name } : null,
    country: c.country ? { id: c.country.id, name: c.country.name } : null,
    region: c.region ? { id: c.region.id, name: c.region.name } : null,
    district: c.district ? { id: c.district.id, name: c.district.name } : null,
    street: c.street,
    latitude: decimalToString(c.latitude),
    longitude: decimalToString(c.longitude),
    phone_number: c.phoneNumber,
    email: c.email,
    logo: mediaUrl(c.logo),
    status: c.status,
    is_active: c.isActive,
    subscription_active: computeSubscriptionActive(c.subscriptions),
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

// Ro'yxat elementi (GET /) — super admin
function serializeListItem(c: CompanyListItem) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    owner: c.owner
      ? {
          id: c.owner.id,
          full_name: c.owner.fullName,
          phone_number: c.owner.phoneNumber,
          email: c.owner.email,
        }
      : null,
    category: c.category ? { id: c.category.id, name: c.category.name } : null,
    country: c.country ? { id: c.country.id, name: c.country.name } : null,
    region: c.region ? { id: c.region.id, name: c.region.name } : null,
    district: c.district ? { id: c.district.id, name: c.district.name } : null,
    status: c.status,
    is_active: c.isActive,
    subscription_active: computeSubscriptionActive(c.subscriptions),
    users_count: c._count.users,
    created_at: c.createdAt,
  };
}

// ── Manzil FK validatsiyasi (ierarxiya mosligini ham tekshiradi) ───

async function validateGeo(
  db: Db,
  data: { country_id?: number | null; region_id?: number | null; district_id?: number | null },
): Promise<void> {
  if (data.country_id) {
    const country = await db.country.findUnique({ where: { id: data.country_id } });
    if (!country) throw new BadRequest({ detail: 'Tanlangan davlat topilmadi.' });
  }
  if (data.region_id) {
    const region = await db.region.findUnique({ where: { id: data.region_id } });
    if (!region) throw new BadRequest({ detail: 'Tanlangan viloyat topilmadi.' });
    if (data.country_id && region.countryId !== data.country_id) {
      throw new BadRequest({ detail: 'Viloyat tanlangan davlatga tegishli emas.' });
    }
  }
  if (data.district_id) {
    const district = await db.district.findUnique({ where: { id: data.district_id } });
    if (!district) throw new BadRequest({ detail: 'Tanlangan tuman topilmadi.' });
    if (data.region_id && district.regionId !== data.region_id) {
      throw new BadRequest({ detail: 'Tuman tanlangan viloyatga tegishli emas.' });
    }
  }
}

async function validateCategory(
  db: Db,
  categoryId: number | null | undefined,
): Promise<void> {
  if (categoryId) {
    const category = await db.companyCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new BadRequest({ detail: 'Tanlangan kategoriya topilmadi.' });
  }
}

// ============================================================
//  ONBOARDING — atomik: company + Owner rol + user yangilash
// ============================================================
export async function onboardCompany(user: User, data: OnboardingInput) {
  // Foydalanuvchi hali kompaniyaga biriktirilmagan bo'lishi shart
  if (user.companyId) {
    throw new BadRequest({ detail: 'Siz allaqachon kompaniyaga egasiz.' });
  }

  // FK'lar mavjudligini (va manzil ierarxiyasini) tranzaksiyadan oldin tekshiramiz
  await validateCategory(prisma, data.category_id ?? null);
  await validateGeo(prisma, {
    country_id: data.country_id ?? null,
    region_id: data.region_id ?? null,
    district_id: data.district_id ?? null,
  });

  const result = await prisma.$transaction(async (tx) => {
    const slug = await generateUniqueSlug(tx, data.name);

    // 1) Company yaratiladi (status='onboarding', ownerId=user.id)
    const company = await tx.company.create({
      data: {
        name: data.name,
        slug,
        ownerId: user.id,
        categoryId: data.category_id ?? null,
        countryId: data.country_id ?? null,
        regionId: data.region_id ?? null,
        districtId: data.district_id ?? null,
        street: data.street ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        phoneNumber: data.phone_number ?? null,
        email: data.email ?? null,
        status: 'onboarding',
      },
      include: fullInclude,
    });

    // 2) Owner (to'liq huquqli) tizim roli yaratiladi
    const ownerRoleId = await provisionOwnerRole(company.id, tx);

    // 3) User yangilanadi: companyId + roleId
    await tx.user.update({
      where: { id: user.id },
      data: { companyId: company.id, roleId: ownerRoleId },
    });

    return { company, ownerRoleId };
  });

  return {
    company: serializeFull(result.company),
    role: { id: result.ownerRoleId, name: 'Owner' },
  };
}

// ============================================================
//  GET /me/ — o'z kompaniyasi to'liq profili
// ============================================================
export async function getMyCompany(companyId: number) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: fullInclude,
  });
  if (!company) throw new NotFound({ detail: 'Kompaniya topilmadi.' });
  return serializeFull(company);
}

// ============================================================
//  PUT /me/ — o'z kompaniyasi profilini yangilash
// ============================================================
export async function updateMyCompany(companyId: number, data: ProfileUpdateInput) {
  const existing = await prisma.company.findUnique({ where: { id: companyId } });
  if (!existing) throw new NotFound({ detail: 'Kompaniya topilmadi.' });

  await validateCategory(prisma, data.category_id);
  // Manzil mosligini joriy qiymatlar bilan birgalikda tekshiramiz
  await validateGeo(prisma, {
    country_id: data.country_id !== undefined ? data.country_id : existing.countryId,
    region_id: data.region_id !== undefined ? data.region_id : existing.regionId,
    district_id: data.district_id !== undefined ? data.district_id : existing.districtId,
  });

  const updateData: Prisma.CompanyUpdateInput = {};
  if (data.name !== undefined) {
    updateData.name = data.name;
    if (data.name !== existing.name) {
      updateData.slug = await generateUniqueSlug(prisma, data.name, companyId);
    }
  }
  if (data.category_id !== undefined) {
    updateData.category = data.category_id
      ? { connect: { id: data.category_id } }
      : { disconnect: true };
  }
  if (data.country_id !== undefined) {
    updateData.country = data.country_id ? { connect: { id: data.country_id } } : { disconnect: true };
  }
  if (data.region_id !== undefined) {
    updateData.region = data.region_id ? { connect: { id: data.region_id } } : { disconnect: true };
  }
  if (data.district_id !== undefined) {
    updateData.district = data.district_id
      ? { connect: { id: data.district_id } }
      : { disconnect: true };
  }
  if (data.street !== undefined) updateData.street = data.street ?? null;
  if (data.latitude !== undefined) updateData.latitude = data.latitude ?? null;
  if (data.longitude !== undefined) updateData.longitude = data.longitude ?? null;
  if (data.phone_number !== undefined) updateData.phoneNumber = data.phone_number ?? null;
  if (data.email !== undefined) updateData.email = data.email ?? null;
  if (data.logo !== undefined) updateData.logo = data.logo ?? null;

  await prisma.company.update({ where: { id: companyId }, data: updateData });

  const refreshed = await prisma.company.findUnique({
    where: { id: companyId },
    include: fullInclude,
  });
  return serializeFull(refreshed!);
}

// ============================================================
//  SUPER ADMIN — ro'yxat (search + filter + pagination)
// ============================================================
export async function listCompanies(params: {
  search?: string;
  status?: string;
  categoryId?: number;
  page: PageParams;
}) {
  const { search, status, categoryId, page } = params;

  const where: Prisma.CompanyWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { phoneNumber: { contains: search } },
    ];
  }
  if (status) where.status = status;
  if (categoryId) where.categoryId = categoryId;

  const [items, count] = await Promise.all([
    prisma.company.findMany({
      where,
      include: listInclude,
      orderBy: { createdAt: 'desc' },
      skip: page.skip,
      take: page.take,
    }),
    prisma.company.count({ where }),
  ]);

  return { results: items.map(serializeListItem), count };
}

// ============================================================
//  SUPER ADMIN — bitta kompaniya to'liq
// ============================================================
export async function getCompanyById(id: number) {
  const company = await prisma.company.findUnique({ where: { id }, include: fullInclude });
  if (!company) throw new NotFound({ detail: 'Kompaniya topilmadi.' });
  return serializeFull(company);
}

// ============================================================
//  SUPER ADMIN — status / is_active o'zgartirish
// ============================================================
export async function updateCompanyStatus(id: number, data: StatusUpdateInput) {
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Kompaniya topilmadi.' });

  const updateData: Prisma.CompanyUpdateInput = {};
  if (data.status !== undefined) updateData.status = data.status;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  await prisma.company.update({ where: { id }, data: updateData });

  const refreshed = await prisma.company.findUnique({ where: { id }, include: fullInclude });
  return serializeFull(refreshed!);
}

// ============================================================
//  SUPER ADMIN — o'chirish (cascade bog'liqliklar)
// ============================================================
export async function deleteCompany(id: number) {
  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Kompaniya topilmadi.' });
  await prisma.company.delete({ where: { id } });
}
