import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  PERMISSIONS,
  COMPANY_PERMISSION_CODES,
  PLATFORM_PERMISSION_CODES,
} from './permissions.catalog.js';

type Db = PrismaClient | Prisma.TransactionClient;

// Katalogdagi barcha ruxsatlarni DB ga sinxronlash (seed/startup) + eskirgan kodlarni tozalash
export async function syncPermissions(db: Db = prisma): Promise<void> {
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { code: p.code },
      update: { label: p.label, module: p.module, scope: p.scope },
      create: { code: p.code, label: p.label, module: p.module, scope: p.scope },
    });
  }
  // Katalogda yo'q (eskirgan) ruxsatlarni o'chiramiz (masalan eski `.manage` kodlari).
  const validCodes = PERMISSIONS.map((p) => p.code);
  await db.permission.deleteMany({ where: { code: { notIn: validCodes } } });
}

// Tizim rollarini (har kompaniya Owner, platforma Super Admin) barcha tegishli
// ruxsatlar bilan qayta to'ldiradi. Katalog o'zgargach chaqiriladi.
export async function regrantSystemRoles(db: Db = prisma): Promise<void> {
  // Kompaniya Owner rollari -> barcha company ruxsatlari
  const companyPerms = await db.permission.findMany({
    where: { code: { in: COMPANY_PERMISSION_CODES } },
    select: { id: true },
  });
  const ownerRoles = await db.role.findMany({ where: { scope: 'company', isSystem: true }, select: { id: true } });
  for (const role of ownerRoles) {
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (companyPerms.length) {
      await db.rolePermission.createMany({ data: companyPerms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
  }

  // Platforma Super Admin rollari -> barcha platform ruxsatlari
  const platformPerms = await db.permission.findMany({
    where: { code: { in: PLATFORM_PERMISSION_CODES } },
    select: { id: true },
  });
  const platformRoles = await db.role.findMany({ where: { scope: 'platform', isSystem: true }, select: { id: true } });
  for (const role of platformRoles) {
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (platformPerms.length) {
      await db.rolePermission.createMany({ data: platformPerms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
  }
}

// Kompaniya yaratilganda Owner (to'liq huquqli) tizim rolini yaratadi va qaytaradi
export async function provisionOwnerRole(companyId: number, db: Db = prisma): Promise<number> {
  const perms = await db.permission.findMany({
    where: { code: { in: COMPANY_PERMISSION_CODES } },
    select: { id: true },
  });

  const role = await db.role.create({
    data: {
      name: 'Owner',
      description: 'Kompaniya egasi — barcha huquqlar',
      scope: 'company',
      companyId,
      isSystem: true,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });
  return role.id;
}

// Super admin (platforma) uchun to'liq huquqli tizim rolini ta'minlaydi
export async function provisionPlatformAdminRole(db: Db = prisma): Promise<number> {
  const existing = await db.role.findFirst({ where: { scope: 'platform', name: 'Super Admin', companyId: null } });
  if (existing) return existing.id;

  const perms = await db.permission.findMany({
    where: { code: { in: PLATFORM_PERMISSION_CODES } },
    select: { id: true },
  });
  const role = await db.role.create({
    data: {
      name: 'Super Admin',
      description: 'Platforma super admin — barcha huquqlar',
      scope: 'platform',
      companyId: null,
      isSystem: true,
      permissions: { create: perms.map((p) => ({ permissionId: p.id })) },
    },
  });
  return role.id;
}

// Rolga ruxsatlarni o'rnatish (kodlar bo'yicha, scope cheklovi bilan)
export async function setRolePermissions(
  roleId: number,
  codes: string[],
  scope: 'platform' | 'company',
  db: Db = prisma,
): Promise<void> {
  const allowed = scope === 'platform' ? PLATFORM_PERMISSION_CODES : COMPANY_PERMISSION_CODES;
  const validCodes = codes.filter((c) => allowed.includes(c));
  const perms = await db.permission.findMany({
    where: { code: { in: validCodes } },
    select: { id: true },
  });
  await db.rolePermission.deleteMany({ where: { roleId } });
  if (perms.length) {
    await db.rolePermission.createMany({
      data: perms.map((p) => ({ roleId, permissionId: p.id })),
    });
  }
}
