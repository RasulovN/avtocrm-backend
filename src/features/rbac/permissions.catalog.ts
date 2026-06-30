// RBAC ruxsatlar katalogi — granular CRUD darajasida.
// Har bir modul uchun amallar (view/create/update/delete + maxsus) alohida ruxsat bo'ladi,
// shunda rol yaratishda aniq amallarga ruxsat berish va "faqat o'qish" (read-only)
// rollar yaratish mumkin.
//
// scope: "platform" (super admin) | "company" (kompaniya)
// alwaysAvailable: obuna faol bo'lmasa ham ochiq (profil, sozlama, obuna).

export interface PermissionDef {
  code: string;
  label: string;
  module: string;
  scope: 'platform' | 'company';
  alwaysAvailable?: boolean;
  action: string; // view | create | update | delete | export | approve | manage
}

// Amal nomlari (UI uchun)
const ACTION_LABEL: Record<string, string> = {
  view: "Ko'rish",
  create: "Qo'shish",
  update: 'Tahrirlash',
  delete: "O'chirish",
  export: 'Eksport',
  approve: 'Tasdiqlash',
  manage: 'Boshqarish',
};

interface ModuleDef {
  module: string;
  label: string;
  scope: 'platform' | 'company';
  actions: string[];
  alwaysAvailable?: boolean;
}

// ───────── COMPANY (kompaniya) modullari ─────────
const COMPANY_MODULES: ModuleDef[] = [
  { module: 'dashboard', label: 'Boshqaruv paneli', scope: 'company', actions: ['view'] },

  { module: 'sales', label: 'Sotuvlar', scope: 'company', actions: ['view', 'create', 'delete'] },
  { module: 'returns', label: 'Qaytarishlar', scope: 'company', actions: ['view', 'create'] },
  { module: 'transfers', label: "Ko'chirishlar", scope: 'company', actions: ['view', 'create', 'approve', 'delete'] },

  { module: 'products', label: 'Mahsulotlar', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'categories', label: 'Mahsulot kategoriyalari', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'brands', label: 'Brendlar', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'stock_entries', label: 'Kirimlar', scope: 'company', actions: ['view', 'create', 'delete'] },
  { module: 'inventory', label: 'Inventarizatsiya', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },

  { module: 'customers', label: 'Mijozlar', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'suppliers', label: "Ta'minotchilar", scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'debts', label: 'Qarzlar', scope: 'company', actions: ['view', 'create'] },

  { module: 'stores', label: "Do'konlar", scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'reports', label: 'Hisobotlar', scope: 'company', actions: ['view', 'export'] },

  { module: 'roles', label: 'Rollar', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },
  { module: 'users', label: 'Xodimlar', scope: 'company', actions: ['view', 'create', 'update', 'delete'] },

  // Obunadan oldin ham ochiq
  { module: 'profile', label: 'Kompaniya profili', scope: 'company', actions: ['view', 'update'], alwaysAvailable: true },
  { module: 'settings', label: 'Sozlamalar', scope: 'company', actions: ['view', 'update'], alwaysAvailable: true },
  { module: 'subscription', label: 'Obuna', scope: 'company', actions: ['view', 'manage'], alwaysAvailable: true },
];

function buildCompany(): PermissionDef[] {
  const out: PermissionDef[] = [];
  for (const m of COMPANY_MODULES) {
    for (const action of m.actions) {
      out.push({
        code: `company.${m.module}.${action}`,
        label: `${m.label}: ${ACTION_LABEL[action] ?? action}`,
        module: m.module,
        scope: 'company',
        action,
        alwaysAvailable: m.alwaysAvailable,
      });
    }
  }
  return out;
}

// ───────── PLATFORM (super admin) ruxsatlari ─────────
// Platforma tomoni view/manage darajasida qoladi (super admin barchasiga ega).
const PLATFORM_DEFS: { code: string; label: string; module: string; action: string }[] = [
  { code: 'platform.dashboard.view', label: 'Platforma paneli', module: 'platform_dashboard', action: 'view' },
  { code: 'platform.companies.view', label: "Kompaniyalar ro'yxati", module: 'platform_companies', action: 'view' },
  { code: 'platform.companies.manage', label: 'Kompaniyalarni boshqarish', module: 'platform_companies', action: 'manage' },
  { code: 'platform.plans.view', label: "Tariflar ro'yxati", module: 'platform_plans', action: 'view' },
  { code: 'platform.plans.manage', label: 'Tariflarni boshqarish', module: 'platform_plans', action: 'manage' },
  { code: 'platform.subscriptions.view', label: "Obunalar ro'yxati", module: 'platform_subscriptions', action: 'view' },
  { code: 'platform.subscriptions.manage', label: 'Obunalarni boshqarish', module: 'platform_subscriptions', action: 'manage' },
  { code: 'platform.payments.view', label: "To'lovlar", module: 'platform_payments', action: 'view' },
  { code: 'platform.company_categories.view', label: 'Kompaniya kategoriyalari', module: 'platform_company_categories', action: 'view' },
  { code: 'platform.company_categories.manage', label: 'Kategoriyalarni boshqarish', module: 'platform_company_categories', action: 'manage' },
  { code: 'platform.geo.view', label: "Manzil ma'lumotlari", module: 'platform_geo', action: 'view' },
  { code: 'platform.geo.manage', label: 'Manzilni boshqarish', module: 'platform_geo', action: 'manage' },
  { code: 'platform.roles.view', label: 'Platforma rollari', module: 'platform_roles', action: 'view' },
  { code: 'platform.roles.manage', label: 'Platforma rollarini boshqarish', module: 'platform_roles', action: 'manage' },
  { code: 'platform.users.view', label: 'Platforma foydalanuvchilari', module: 'platform_users', action: 'view' },
  { code: 'platform.users.manage', label: 'Platforma foydalanuvchilarini boshqarish', module: 'platform_users', action: 'manage' },
  { code: 'platform.leads.view', label: "Ledlar ro'yxati", module: 'platform_leads', action: 'view' },
  { code: 'platform.leads.manage', label: 'Ledlarni boshqarish', module: 'platform_leads', action: 'manage' },
  { code: 'platform.support.view', label: "Qo'llab-quvvatlash chatlari", module: 'platform_support', action: 'view' },
  { code: 'platform.support.manage', label: "Qo'llab-quvvatlashga javob berish", module: 'platform_support', action: 'manage' },
  { code: 'platform.settings.view', label: 'Sayt sozlamalari', module: 'platform_settings', action: 'view' },
  { code: 'platform.settings.manage', label: 'Sayt sozlamalarini boshqarish', module: 'platform_settings', action: 'manage' },
];

const PLATFORM_PERMS: PermissionDef[] = PLATFORM_DEFS.map((p) => ({
  ...p, scope: 'platform' as const,
}));

export const PERMISSIONS: PermissionDef[] = [...PLATFORM_PERMS, ...buildCompany()];

// ───────── Yordamchi indekslar ─────────
export const PERMISSION_BY_CODE = new Map(PERMISSIONS.map((p) => [p.code, p]));

export const ALWAYS_AVAILABLE_CODES = new Set(
  PERMISSIONS.filter((p) => p.alwaysAvailable).map((p) => p.code),
);

export const PLATFORM_PERMISSION_CODES = PERMISSIONS.filter((p) => p.scope === 'platform').map((p) => p.code);
export const COMPANY_PERMISSION_CODES = PERMISSIONS.filter((p) => p.scope === 'company').map((p) => p.code);
