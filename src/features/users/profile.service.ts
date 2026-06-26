import type { User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

// DRF ProfileView + ProfileSerializer ekvivalenti
export async function getProfile(user: User) {
  let stores: { id: number; name: string; phone_number: string; address: string; type: string; is_active: boolean; role: string | null }[];

  if (user.isSuperuser) {
    const all = await prisma.store.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
    stores = all.map((s) => ({
      id: s.id,
      name: s.name,
      phone_number: s.phoneNumber,
      address: s.address,
      type: s.type,
      is_active: s.isActive,
      role: 'superuser',
    }));
  } else {
    const links = await prisma.storeUser.findMany({
      where: { userId: user.id, isActive: true, store: { isActive: true } },
      include: { store: true },
      orderBy: { store: { name: 'asc' } },
    });
    stores = links.map((l) => ({
      id: l.store.id,
      name: l.store.name,
      phone_number: l.store.phoneNumber,
      address: l.store.address,
      type: l.store.type,
      is_active: l.store.isActive,
      role: l.role,
    }));
  }

  const history = await prisma.userHistory.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return {
    id: user.id,
    is_superuser: user.isSuperuser,
    full_name: user.fullName,
    phone_number: user.phoneNumber,
    email: user.email,
    role: user.isSuperuser ? 'superuser' : (stores[0]?.role ?? null),
    stores,
    history: history.map((h) => ({
      id: h.id,
      action: h.action,
      ip_address: h.ipAddress,
      user_agent: h.userAgent,
      created_at: h.createdAt,
    })),
  };
}
