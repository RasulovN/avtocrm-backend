import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { syncPermissions, provisionPlatformAdminRole, regrantSystemRoles } from '../src/features/rbac/rbac.service.js';

const prisma = new PrismaClient();

// ───── Boshlang'ich super admin ma'lumotlari — .env dan ─────
// SEED_ADMIN_EMAIL / SEED_ADMIN_PHONE / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME.
// Development'da berilmasa default qiymatlar ishlatiladi; production'da parol
// MAJBURIY — default parol bilan prod bazaga seed qilishga yo'l qo'ymaymiz.
const IS_PROD = process.env.NODE_ENV === 'production';
const DEV_DEFAULT_PASSWORD = 'admin12345';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@autocrm.local';
const ADMIN_PHONE = process.env.SEED_ADMIN_PHONE ?? '+998901234567';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Super Administrator';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? (IS_PROD ? '' : DEV_DEFAULT_PASSWORD);

if (!ADMIN_PASSWORD) {
  throw new Error(
    'SEED_ADMIN_PASSWORD .env da berilishi shart (production). ' +
      'Kamida 8 belgili kuchli parol kiriting.',
  );
}
if (IS_PROD && ADMIN_PASSWORD.length < 8) {
  throw new Error('SEED_ADMIN_PASSWORD juda qisqa — kamida 8 belgi bo\'lsin.');
}

async function main() {
  // 1) Ruxsatlar katalogini DB ga sinxronlash
  await syncPermissions(prisma);
  console.log('✓ Permissions synced');

  // 2) Platforma Super Admin roli (barcha platform ruxsatlari bilan)
  const platformRoleId = await provisionPlatformAdminRole(prisma);
  console.log('✓ Platform Super Admin role:', platformRoleId);

  // 2b) Tizim rollarini (Owner / Super Admin) barcha ruxsatlar bilan qayta to'ldirish
  // (katalog granular CRUD'ga o'zgargani uchun mavjud rollar yangilanadi).
  await regrantSystemRoles(prisma);
  console.log('✓ System roles re-granted (granular CRUD)');

  // 3) Super admin foydalanuvchi (.env: SEED_ADMIN_*)
  const password = await bcrypt.hash(ADMIN_PASSWORD, 10);
  // Parol .env da ANIQ berilgan bo'lsa, qayta seed'da ham yangilanadi —
  // shunda parolni .env orqali almashtirish mumkin. Berilmagan bo'lsa
  // (dev default), mavjud admin paroli tegilmaydi.
  const passwordUpdate = process.env.SEED_ADMIN_PASSWORD ? { password } : {};
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      roleId: platformRoleId,
      isSuperuser: true,
      isStaff: true,
      isEmailVerified: true,
      ...passwordUpdate,
    },
    create: {
      fullName: ADMIN_NAME,
      phoneNumber: ADMIN_PHONE,
      email: ADMIN_EMAIL,
      password,
      isActive: true,
      isStaff: true,
      isSuperuser: true,
      isEmailVerified: true,
      roleId: platformRoleId,
    },
  });
  console.log('✓ Super admin:', admin.email);

  // 4) Demo tariflar (obuna rejalari)
  const plans = [
    { name: 'Sinov (Trial)', description: '14 kunlik bepul sinov', price: 0, durationDays: 14, maxStores: 1, maxUsers: 3, sortOrder: 0 },
    { name: "Boshlang'ich", description: 'Kichik biznes uchun', price: 99000, durationDays: 30, maxStores: 3, maxUsers: 10, sortOrder: 1 },
    { name: 'Biznes', description: "O'sayotgan biznes uchun", price: 299000, durationDays: 30, maxStores: 10, maxUsers: 50, sortOrder: 2 },
  ];
  for (const p of plans) {
    const existing = await prisma.plan.findFirst({ where: { name: p.name } });
    if (!existing) {
      await prisma.plan.create({ data: p });
    }
  }
  console.log('✓ Demo plans');

  // 5) Demo kompaniya kategoriyalari (sohalar)
  const categories = [
    { name: 'Oziq-ovqat', slug: 'oziq-ovqat' },
    { name: 'Avto ehtiyot qismlar', slug: 'avto-ehtiyot-qismlar' },
    { name: 'Maishiy texnika', slug: 'maishiy-texnika' },
    { name: 'Kiyim-kechak', slug: 'kiyim-kechak' },
  ];
  for (const c of categories) {
    await prisma.companyCategory.upsert({
      where: { slug: c.slug },
      update: {},
      create: c,
    });
  }
  console.log('✓ Demo company categories');

  const passwordNote = process.env.SEED_ADMIN_PASSWORD
    ? '(parol .env dagi SEED_ADMIN_PASSWORD)'
    : `/ parol: ${DEV_DEFAULT_PASSWORD} (dev default — .env da SEED_ADMIN_PASSWORD bilan o'zgartiring)`;
  console.log(`\nSeed tugadi. Super admin: ${ADMIN_EMAIL} yoki ${ADMIN_PHONE} ${passwordNote}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
