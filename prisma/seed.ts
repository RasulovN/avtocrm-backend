import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { syncPermissions, provisionPlatformAdminRole, regrantSystemRoles } from '../src/features/rbac/rbac.service.js';

const prisma = new PrismaClient();

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

  // 3) Super admin foydalanuvchi
  const password = await bcrypt.hash('admin12345', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@autocrm.local' },
    update: { roleId: platformRoleId, isSuperuser: true, isStaff: true, isEmailVerified: true },
    create: {
      fullName: 'Super Administrator',
      phoneNumber: '+998901234567',
      email: 'admin@autocrm.local',
      password,
      isActive: true,
      isStaff: true,
      isSuperuser: true,
      isEmailVerified: true,
      roleId: platformRoleId,
    },
  });
  console.log('✓ Super admin:', admin.email, '/ parol: admin12345');

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

  console.log('\nSeed tugadi. Super admin: admin@autocrm.local yoki +998901234567 / admin12345');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
