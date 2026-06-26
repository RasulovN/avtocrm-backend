import { randomBytes } from 'node:crypto';
import type { Company, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { hashPassword } from '../../common/password.js';
import { sendMail } from '../../common/email.js';
import { verificationEmail } from '../../common/emailTemplates.js';
import { env } from '../../config/env.js';
import {
  PERMISSIONS,
  ALWAYS_AVAILABLE_CODES,
  type PermissionDef,
} from '../rbac/permissions.catalog.js';

// ============================================================
//  Email tasdiqlash tokeni
// ============================================================

// Kriptografik xavfsiz random token (havola uchun).
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

// Foydalanuvchi uchun yangi EmailVerification yozadi va tasdiqlash xatini yuboradi.
export async function issueEmailVerification(user: { id: number; email: string }): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + env.EMAIL_VERIFICATION_TTL * 1000);

  await prisma.emailVerification.create({
    data: { userId: user.id, token, expiresAt },
  });

  const link = `${env.FRONTEND_URL}/verify-email?token=${token}`;
  const hours = Math.round(env.EMAIL_VERIFICATION_TTL / 3600);
  const { html, text } = verificationEmail({ link, hours });
  await sendMail({
    to: user.email,
    subject: 'Email manzilingizni tasdiqlang',
    text,
    html,
  });
}

// ============================================================
//  Foydalanuvchi serializatsiyasi (login/me javoblari uchun)
// ============================================================

interface SerializableUser {
  id: number;
  fullName: string | null;
  email: string | null;
  phoneNumber: string | null;
  isSuperuser: boolean;
  isEmailVerified: boolean;
  companyId: number | null;
  role?: { name: string } | null;
}

// User -> snake_case javob obyekti.
export function serializeUser(user: SerializableUser): {
  id: number;
  full_name: string | null;
  email: string | null;
  phone_number: string | null;
  is_superuser: boolean;
  is_email_verified: boolean;
  company_id: number | null;
  role: string | null;
} {
  return {
    id: user.id,
    full_name: user.fullName,
    email: user.email,
    phone_number: user.phoneNumber,
    is_superuser: user.isSuperuser,
    is_email_verified: user.isEmailVerified,
    company_id: user.companyId,
    role: user.role?.name ?? null,
  };
}

// ============================================================
//  Kompaniya serializatsiyasi (me javobi uchun)
// ============================================================

export function serializeCompany(company: Company | null): {
  id: number;
  name: string;
  slug: string | null;
  status: string;
  is_active: boolean;
  logo: string | null;
} | null {
  if (!company) return null;
  return {
    id: company.id,
    name: company.name,
    slug: company.slug,
    status: company.status,
    is_active: company.isActive,
    logo: company.logo,
  };
}

// ============================================================
//  Menyular (sidebar) — me javobi uchun
// ============================================================

export interface MenuItem {
  module: string;
  label: string;
  scope: 'platform' | 'company';
  available: boolean;
}

// Foydalanuvchining ruxsatlari asosida kira oladigan UNIKAL menyularni yig'adi.
// Har modul uchun `*.view` ruxsati hisobga olinadi (asosiy menyu kirish nuqtasi).
// `available` = ruxsat bor VA (alwaysAvailable yoki obuna faol yoki super admin).
export function buildMenus(
  permissions: Set<string>,
  opts: { isSuperuser: boolean; subscriptionActive: boolean },
): MenuItem[] {
  // Super admin -> platform menyular; oddiy foydalanuvchi -> company menyular.
  const targetScope: 'platform' | 'company' = opts.isSuperuser ? 'platform' : 'company';

  // Modul bo'yicha birinchi mos PermissionDef (label/scope manbasi).
  const byModule = new Map<string, PermissionDef>();
  for (const perm of PERMISSIONS) {
    if (perm.scope !== targetScope) continue;
    // Faqat `.view` ruxsatlari menyu kirish nuqtasi sifatida qaraladi.
    if (!perm.code.endsWith('.view')) continue;
    if (opts.isSuperuser || permissions.has(perm.code)) {
      if (!byModule.has(perm.module)) byModule.set(perm.module, perm);
    }
  }

  const menus: MenuItem[] = [];
  for (const perm of byModule.values()) {
    const available =
      opts.isSuperuser ||
      ALWAYS_AVAILABLE_CODES.has(perm.code) ||
      opts.subscriptionActive;
    menus.push({
      module: perm.module,
      // "Mahsulotlar: Ko'rish" -> "Mahsulotlar" (toza menyu nomi)
      label: perm.label.includes(':') ? perm.label.split(':')[0]!.trim() : perm.label,
      scope: perm.scope,
      available,
    });
  }
  return menus;
}

// ============================================================
//  Ro'yxatdan o'tish
// ============================================================

// Email + parol bilan yangi foydalanuvchi yaratadi (tasdiqlanmagan, kompaniyasiz).
export async function registerUser(input: {
  email: string;
  password: string;
  full_name?: string;
}): Promise<User> {
  return prisma.user.create({
    data: {
      email: input.email,
      password: await hashPassword(input.password),
      fullName: input.full_name ?? null,
      isEmailVerified: false,
      companyId: null,
      roleId: null,
    },
  });
}
