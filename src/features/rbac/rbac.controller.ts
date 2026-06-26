import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { hashPassword } from '../../common/password.js';
import { checkValidPhone, checkValidEmail } from '../../common/validators.js';
import { BadRequest, NotFound, ValidationError } from '../../common/errors.js';
import {
  PERMISSIONS,
  PERMISSION_BY_CODE,
  PLATFORM_PERMISSION_CODES,
  COMPANY_PERMISSION_CODES,
} from './permissions.catalog.js';
import { setRolePermissions } from './rbac.service.js';
import type {
  RoleCreateInput,
  RoleUpdateInput,
  UserCreateInput,
  UserUpdateInput,
} from './rbac.schemas.js';

type Scope = 'platform' | 'company';

// ============================================================
//  RUXSATLAR (katalogni modul bo'yicha guruhlash)
// ============================================================

interface PermissionGroup {
  module: string;
  module_label: string;
  permissions: { code: string; label: string }[];
}

// Berilgan scope'lar uchun katalog ruxsatlarini modul bo'yicha guruhlab qaytaradi.
// Modul tartibi katalogdagi birinchi uchrash tartibida saqlanadi.
export function groupPermissionsByModule(scopes: Scope[]): PermissionGroup[] {
  const groups = new Map<string, PermissionGroup>();
  for (const p of PERMISSIONS) {
    if (!scopes.includes(p.scope)) continue;
    let group = groups.get(p.module);
    if (!group) {
      // "Mahsulotlar: Qo'shish" -> modul nomi "Mahsulotlar"
      const moduleLabel = p.label.includes(':') ? p.label.split(':')[0]!.trim() : p.label;
      group = { module: p.module, module_label: moduleLabel, permissions: [] };
      groups.set(p.module, group);
    }
    // Guruh ichida faqat amal nomi: "Mahsulotlar: Qo'shish" -> "Qo'shish"
    const permLabel = p.label.includes(':') ? p.label.split(':').slice(1).join(':').trim() : p.label;
    group.permissions.push({ code: p.code, label: permLabel });
  }
  return [...groups.values()];
}

// ============================================================
//  ROL SERIALIZATSIYA
// ============================================================

type RoleWithRels = Prisma.RoleGetPayload<{
  include: {
    permissions: { include: { permission: true } };
    _count: { select: { users: true } };
  };
}>;

function serializeRole(role: RoleWithRels) {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    scope: role.scope,
    company_id: role.companyId,
    is_system: role.isSystem,
    permissions: role.permissions.map((rp) => rp.permission.code),
    users_count: role._count.users,
    created_at: role.createdAt,
    updated_at: role.updatedAt,
  };
}

const roleInclude = {
  permissions: { include: { permission: true } },
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

// ============================================================
//  ROLLAR — scope'ga bog'liq umumiy mantiq
// ============================================================

// scope='platform' -> companyId null; scope='company' -> companyId aniq qiymat.
// Bir joyda berilgan scope/companyId bilan rol topiladi (boshqa scope/tenant ko'rinmaydi).
function roleScopeWhere(scope: Scope, companyId: number | null): Prisma.RoleWhereInput {
  return scope === 'platform'
    ? { scope: 'platform', companyId: null }
    : { scope: 'company', companyId: companyId };
}

// Faqat ruxsat etilgan scope kodlari (boshqa scope kodlari rad etiladi)
function assertCodesInScope(codes: string[], scope: Scope): void {
  const allowed = scope === 'platform' ? PLATFORM_PERMISSION_CODES : COMPANY_PERMISSION_CODES;
  const invalid = codes.filter((c) => !PERMISSION_BY_CODE.has(c) || !allowed.includes(c));
  if (invalid.length) {
    throw new ValidationError({
      permissions: `Bu scope uchun ruxsat etilmagan kodlar: ${invalid.join(', ')}`,
    });
  }
}

export async function listRoles(scope: Scope, companyId: number | null) {
  const roles = await prisma.role.findMany({
    where: roleScopeWhere(scope, companyId),
    include: roleInclude,
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
  return roles.map(serializeRole);
}

// Xodimga rol biriktirish uchun yengil ro'yxat ({id, name}). `company.roles.view` EMAS,
// `company.users.view` ruxsati bilan ochiq — xodim boshqaruvchisi rollarni ko'ra olishi shart.
export async function listAssignableRoles(scope: Scope, companyId: number | null) {
  const roles = await prisma.role.findMany({
    where: roleScopeWhere(scope, companyId),
    select: { id: true, name: true, isSystem: true },
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
  });
  return roles.map((r) => ({ id: r.id, name: r.name, is_system: r.isSystem }));
}

// Rolni id bo'yicha topadi va scope/tenant mosligini tekshiradi (cross-scope/cross-tenant himoyasi)
async function getScopedRoleOrThrow(id: number, scope: Scope, companyId: number | null) {
  const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) throw new NotFound({ detail: 'Rol topilmadi.' });
  const w = roleScopeWhere(scope, companyId);
  if (role.scope !== w.scope || role.companyId !== (w.companyId ?? null)) {
    // Boshqa scope yoki boshqa kompaniya roli — mavjud emasdek 404
    throw new NotFound({ detail: 'Rol topilmadi.' });
  }
  return role;
}

export async function getRole(id: number, scope: Scope, companyId: number | null) {
  return serializeRole(await getScopedRoleOrThrow(id, scope, companyId));
}

export async function createRole(
  input: RoleCreateInput,
  scope: Scope,
  companyId: number | null,
) {
  assertCodesInScope(input.permissions, scope);

  // Nom takrorlanmasligi (companyId + name unique)
  const existing = await prisma.role.findFirst({
    where: { ...roleScopeWhere(scope, companyId), name: input.name },
  });
  if (existing) {
    throw new ValidationError({ name: 'Bu nomdagi rol allaqachon mavjud.' });
  }

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.role.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        scope,
        companyId: scope === 'platform' ? null : companyId,
        isSystem: false,
      },
    });
    await setRolePermissions(created.id, input.permissions, scope, tx);
    return created;
  });

  return getRole(role.id, scope, companyId);
}

export async function updateRole(
  id: number,
  input: RoleUpdateInput,
  scope: Scope,
  companyId: number | null,
) {
  const role = await getScopedRoleOrThrow(id, scope, companyId);
  // Tizim rollari (Owner, Super Admin) tahrirlanmaydi
  if (role.isSystem) {
    throw new BadRequest({ detail: "Tizim rolini tahrirlab bo'lmaydi." });
  }

  if (input.permissions) assertCodesInScope(input.permissions, scope);

  if (input.name && input.name !== role.name) {
    const dup = await prisma.role.findFirst({
      where: { ...roleScopeWhere(scope, companyId), name: input.name, id: { not: id } },
    });
    if (dup) throw new ValidationError({ name: 'Bu nomdagi rol allaqachon mavjud.' });
  }

  await prisma.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        description: input.description === undefined ? undefined : input.description,
      },
    });
    if (input.permissions) {
      await setRolePermissions(id, input.permissions, scope, tx);
    }
  });

  return getRole(id, scope, companyId);
}

export async function deleteRole(id: number, scope: Scope, companyId: number | null) {
  const role = await getScopedRoleOrThrow(id, scope, companyId);
  // Tizim rollari o'chirilmaydi
  if (role.isSystem) {
    throw new BadRequest({ detail: "Tizim rolini o'chirib bo'lmaydi." });
  }
  // Rolga bog'langan foydalanuvchilar bo'lsa — avval bo'shatish kerak
  if (role._count.users > 0) {
    throw new BadRequest({
      detail: `Bu rolga ${role._count.users} ta foydalanuvchi biriktirilgan. Avval ularni boshqa rolga o'tkazing.`,
    });
  }
  await prisma.role.delete({ where: { id } });
}

// ============================================================
//  FOYDALANUVCHI SERIALIZATSIYA
// ============================================================

type UserWithRole = Prisma.UserGetPayload<{ include: { role: true } }>;

function serializeUser(user: UserWithRole) {
  return {
    id: user.id,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    email: user.email,
    is_active: user.isActive,
    is_email_verified: user.isEmailVerified,
    company_id: user.companyId,
    role_id: user.roleId,
    // Frontend `u.role` (rol nomi) o'qiydi; `role_name` eski klientlar uchun saqlanadi.
    role: user.role?.name ?? null,
    role_name: user.role?.name ?? null,
    created_at: user.createdAt,
    updated_at: user.updatedAt,
  };
}

// ============================================================
//  FOYDALANUVCHILAR — scope'ga bog'liq umumiy mantiq
// ============================================================

// Foydalanuvchilar to'plamini scope'ga qarab cheklaydi.
// platform -> companyId null (super admin/platform userlar), company -> companyId aniq tenant.
function userScopeWhere(scope: Scope, companyId: number | null): Prisma.UserWhereInput {
  return scope === 'platform' ? { companyId: null } : { companyId };
}

export async function listUsers(
  scope: Scope,
  companyId: number | null,
  pageParams: { skip: number; take: number },
) {
  const where = userScopeWhere(scope, companyId);
  const [users, count] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: { role: true },
      orderBy: { createdAt: 'desc' },
      skip: pageParams.skip,
      take: pageParams.take,
    }),
    prisma.user.count({ where }),
  ]);
  return { results: users.map(serializeUser), count };
}

// Super admin: BARCHA foydalanuvchilar (platform + barcha kompaniyalar), kompaniya nomi bilan.
type UserWithRoleCompany = Prisma.UserGetPayload<{ include: { role: true; company: { select: { id: true; name: true } } } }>;

export async function listAllUsers(
  filters: { search?: string; company_id?: number },
  pageParams: { skip: number; take: number },
) {
  const where: Prisma.UserWhereInput = {};
  if (filters.company_id) where.companyId = filters.company_id;
  if (filters.search) {
    where.OR = [
      { fullName: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { phoneNumber: { contains: filters.search, mode: 'insensitive' } },
    ];
  }
  const [users, count] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      include: { role: true, company: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      skip: pageParams.skip,
      take: pageParams.take,
    }),
    prisma.user.count({ where }),
  ]);
  const results = (users as UserWithRoleCompany[]).map((u) => ({
    id: u.id,
    full_name: u.fullName,
    phone_number: u.phoneNumber,
    email: u.email,
    is_active: u.isActive,
    is_email_verified: u.isEmailVerified,
    is_superuser: u.isSuperuser,
    company_id: u.companyId,
    company_name: u.company?.name ?? null,
    role_id: u.roleId,
    role: u.role?.name ?? null,
    role_name: u.role?.name ?? null,
    created_at: u.createdAt,
  }));
  return { results, count };
}

// Foydalanuvchini scope/tenant doirasida topadi (boshqa tenant useriga tegib bo'lmaydi)
async function getScopedUserOrThrow(id: number, scope: Scope, companyId: number | null) {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new NotFound({ detail: 'Foydalanuvchi topilmadi.' });
  const w = userScopeWhere(scope, companyId);
  if (user.companyId !== ((w.companyId as number | null) ?? null)) {
    throw new NotFound({ detail: 'Foydalanuvchi topilmadi.' });
  }
  return user;
}

// role_id berilgan scope/tenant roliga tegishli ekanini tekshiradi
async function assertRoleBelongsToScope(roleId: number, scope: Scope, companyId: number | null) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  const w = roleScopeWhere(scope, companyId);
  if (!role || role.scope !== w.scope || role.companyId !== (w.companyId ?? null)) {
    throw new ValidationError({ role_id: 'Bu rol mavjud emas yoki sizning doirangizga tegishli emas.' });
  }
  return role;
}

export async function createUser(
  input: UserCreateInput,
  scope: Scope,
  companyId: number | null,
) {
  // Telefon/email validatsiyasi
  if (input.phone_number) checkValidPhone(input.phone_number);
  if (input.email) checkValidEmail(input.email);

  // role_id albatta shu scope/tenant roliga tegishli bo'lishi shart
  await assertRoleBelongsToScope(input.role_id, scope, companyId);

  // Telefon/email takrorlanmasligi (User'da unique)
  if (input.phone_number) {
    const dup = await prisma.user.findUnique({ where: { phoneNumber: input.phone_number } });
    if (dup) throw new ValidationError({ phone_number: 'Bu telefon raqam allaqachon mavjud.' });
  }
  if (input.email) {
    const dup = await prisma.user.findUnique({ where: { email: input.email } });
    if (dup) throw new ValidationError({ email: 'Bu email allaqachon mavjud.' });
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: {
      fullName: input.full_name,
      phoneNumber: input.phone_number ?? null,
      email: input.email ?? null,
      password: passwordHash,
      companyId: scope === 'platform' ? null : companyId,
      roleId: input.role_id,
      // Admin tomonidan qo'shilgani uchun email tasdiqlangan deb hisoblanadi
      isEmailVerified: true,
      isActive: true,
    },
    include: { role: true },
  });
  return serializeUser(user);
}

export async function updateUser(
  id: number,
  input: UserUpdateInput,
  scope: Scope,
  companyId: number | null,
) {
  const user = await getScopedUserOrThrow(id, scope, companyId);

  // Owner (kompaniya egasi) himoyasi: rolini/holatini o'zgartirib bo'lmaydi
  if (user.role?.isSystem) {
    throw new BadRequest({ detail: "Owner foydalanuvchini tahrirlab bo'lmaydi." });
  }

  if (input.role_id !== undefined) {
    await assertRoleBelongsToScope(input.role_id, scope, companyId);
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      fullName: input.full_name ?? undefined,
      roleId: input.role_id ?? undefined,
      isActive: input.is_active ?? undefined,
    },
    include: { role: true },
  });
  return serializeUser(updated);
}

export async function deleteUser(id: number, scope: Scope, companyId: number | null) {
  const user = await getScopedUserOrThrow(id, scope, companyId);
  if (user.role?.isSystem) {
    throw new BadRequest({ detail: "Owner foydalanuvchini o'chirib bo'lmaydi." });
  }
  await prisma.user.delete({ where: { id } });
}

// ─────────────────────────────────────────────
//  SUPER ADMIN — "Barcha foydalanuvchilar" ro'yxatidan istalgan userni o'chirish.
//  Qoida: foydalanuvchi biror kompaniyaga tegishli bo'lsa (ega yoki a'zo), uni
//  to'g'ridan-to'g'ri o'chirib bo'lmaydi — avval kompaniya o'chirilishi kerak.
//  `cascadeCompany=true` bilan kompaniya (va uning BARCHA ma'lumotlari) hamda
//  foydalanuvchi bitta tranzaksiyada birga o'chiriladi.
// ─────────────────────────────────────────────
export async function deleteAnyUser(
  id: number,
  opts: { cascadeCompany?: boolean },
  actingUserId: number,
) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!user) throw new NotFound({ detail: 'Foydalanuvchi topilmadi.' });
  if (user.isSuperuser) {
    throw new BadRequest({ detail: "Super adminni o'chirib bo'lmaydi." });
  }
  if (user.id === actingUserId) {
    throw new BadRequest({ detail: "O'zingizni o'chira olmaysiz." });
  }

  // Foydalanuvchi EGA bo'lgan kompaniya (ownerId) yoki A'ZO bo'lgan kompaniya.
  const ownedCompany = await prisma.company.findFirst({
    where: { ownerId: id },
    select: { id: true, name: true },
  });
  const linkedCompany = ownedCompany ?? user.company;

  if (linkedCompany) {
    if (!opts.cascadeCompany) {
      throw new BadRequest({
        detail: `Bu foydalanuvchi "${linkedCompany.name}" kompaniyasiga tegishli. Avval kompaniyani o'chiring.`,
      });
    }
    // Kompaniyani o'chirsak: a'zolarning companyId→null, CRM/rollar/obunalar cascade
    // o'chadi; so'ng foydalanuvchining o'zini o'chiramiz.
    await prisma.$transaction(async (tx) => {
      await tx.company.delete({ where: { id: linkedCompany.id } });
      await tx.user.delete({ where: { id } });
    });
    return;
  }

  await prisma.user.delete({ where: { id } });
}
