import { prisma } from '../../db/prisma.js';
import { hashPassword } from '../../common/password.js';
import { ValidationError, NotFound } from '../../common/errors.js';

// ---- User serializatsiya (DRF UserSerializer / UserResponseSerializer ekvivalenti) ----

export interface UserWithStoreLink {
  id: number;
  fullName: string | null;
  phoneNumber: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  storeLinks?: { store: { id: number; name: string } }[];
}

export function serializeUser(u: UserWithStoreLink) {
  const link = u.storeLinks?.[0];
  return {
    id: u.id,
    full_name: u.fullName,
    phone_number: u.phoneNumber,
    email: u.email,
    is_active: u.isActive,
    created_at: u.createdAt,
    updated_at: u.updatedAt,
    store_id: link ? link.store.id : null,
    store_name: link ? link.store.name : null,
  };
}

// DRF UsersListView: superuser bo'lmagan userlar + active store link
export async function listUsers() {
  const users = await prisma.user.findMany({
    where: { isSuperuser: false },
    include: {
      storeLinks: { where: { isActive: true }, include: { store: true } },
    },
  });
  return users.map(serializeUser);
}

export async function getUser(id: number) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { storeLinks: { where: { isActive: true }, include: { store: true } } },
  });
  if (!user) throw new NotFound();
  return user;
}

export async function updateUser(
  id: number,
  data: { full_name?: string | null; phone_number?: string; email?: string | null; is_active?: boolean },
) {
  await getUser(id);
  const user = await prisma.user.update({
    where: { id },
    data: {
      fullName: data.full_name,
      phoneNumber: data.phone_number,
      email: data.email,
      isActive: data.is_active,
    },
    include: { storeLinks: { where: { isActive: true }, include: { store: true } } },
  });
  return user;
}

export async function deleteUser(id: number) {
  await getUser(id);
  await prisma.user.delete({ where: { id } });
}

// DRF UserService.create_seller_with_store
export async function createSellerWithStore(params: {
  requestUserIsSuperuser: boolean;
  full_name: string;
  phone_number: string;
  email: string;
  password: string;
  store_id: number;
  role: string;
}) {
  if (!params.requestUserIsSuperuser) {
    throw new ValidationError('Faqat superuser seller yaratishi mumkin');
  }

  const existing = await prisma.user.findUnique({ where: { phoneNumber: params.phone_number } });
  if (existing) {
    throw new ValidationError('User already exists');
  }

  const emailExists = await prisma.user.findFirst({ where: { email: params.email } });
  if (emailExists) {
    throw new ValidationError({ error: 'Email already exists' });
  }

  const store = await prisma.store.findUnique({ where: { id: params.store_id } });
  if (!store) {
    throw new ValidationError('Store topilmadi');
  }

  const passwordHash = await hashPassword(params.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        fullName: params.full_name,
        phoneNumber: params.phone_number,
        email: params.email,
        password: passwordHash,
      },
    });
    await tx.storeUser.create({
      data: { userId: user.id, storeId: store.id, role: params.role },
    });
    return user;
  });
}

// DRF UserResponseSerializer
export async function serializeUserResponse(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { storeLinks: { where: { isActive: true }, include: { store: true } } },
  });
  if (!user) throw new NotFound();
  return {
    id: user.id,
    phone_number: user.phoneNumber,
    full_name: user.fullName,
    store: user.storeLinks[0]?.store.name ?? null,
    email: user.email,
  };
}
