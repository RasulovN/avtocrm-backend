import type { Prisma, Store, StoreUser, User } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import { checkValidPhone } from '../../common/validators.js';
import type { StoreCreateInput, StoreUpdateInput } from './store.schemas.js';

// ── Tiplar ────────────────────────────────────────────────

type StoreUserWithUser = StoreUser & { user: User };
type StoreWithLinks = Store & { userLinks: StoreUserWithUser[] };

// Decimal -> string (DRF DecimalField kabi). null bo'lsa null qaytaramiz.
function decimalToString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

// ── Serializatsiya ────────────────────────────────────────

// Django StoreSellerSerializer
function serializeSeller(link: StoreUserWithUser) {
  return {
    id: link.user.id,
    full_name: link.user.fullName,
    phone_number: link.user.phoneNumber,
  };
}

// Django StoreListSerializer: name/address translated (modeltranslation -> name/address)
function serializeStoreList(store: StoreWithLinks) {
  return {
    id: store.id,
    type: store.type,
    name: store.name,
    phone_number: store.phoneNumber,
    address: store.address,
    latitude: decimalToString(store.latitude),
    longitude: decimalToString(store.longitude),
    is_active: store.isActive,
    sellers: store.userLinks.filter((l) => l.isActive).map(serializeSeller),
  };
}

// Django StoreDetailSerializer: name_uz/name_uz_cyrl/address_uz/address_uz_cyrl
function serializeStoreDetail(store: StoreWithLinks) {
  return {
    id: store.id,
    name_uz: store.name,
    name_uz_cyrl: store.nameUzCyrl,
    phone_number: store.phoneNumber,
    address_uz: store.address,
    address_uz_cyrl: store.addressUzCyrl,
    type: store.type,
    latitude: decimalToString(store.latitude),
    longitude: decimalToString(store.longitude),
    is_active: store.isActive,
    sellers: store.userLinks.filter((l) => l.isActive).map(serializeSeller),
  };
}

// Django StoreResponseSerializer (fields = "__all__")
function serializeStoreResponse(store: Store) {
  return {
    id: store.id,
    name: store.name,
    name_uz_cyrl: store.nameUzCyrl,
    phone_number: store.phoneNumber,
    address: store.address,
    address_uz_cyrl: store.addressUzCyrl,
    type: store.type,
    latitude: decimalToString(store.latitude),
    longitude: decimalToString(store.longitude),
    is_active: store.isActive,
    created_at: store.createdAt,
    updated_at: store.updatedAt,
  };
}

const linksInclude = {
  userLinks: { where: { isActive: true }, include: { user: true } },
} satisfies Prisma.StoreInclude;

// ── Selectorlar ───────────────────────────────────────────

// Django StoreSelector.get_store (get_object_or_404)
// Tenant-scope: faqat shu companyId ga tegishli do'kon topiladi.
async function getStoreWithLinks(pk: number, companyId: number): Promise<StoreWithLinks> {
  const store = await prisma.store.findFirst({
    where: { id: pk, companyId },
    include: linksInclude,
  });
  if (!store) throw new NotFound();
  return store as StoreWithLinks;
}

// ── Service operatsiyalari ────────────────────────────────

// Django StoreListAPIView.get -> StoreSelector.store_list -> StoreListSerializer
// Tenant-scope: faqat shu companyId do'konlari.
export async function listStores(companyId: number) {
  const stores = await prisma.store.findMany({ where: { companyId }, include: linksInclude });
  return (stores as StoreWithLinks[]).map(serializeStoreList);
}

// Django StoreDetailAPIView.get -> StoreDetailSerializer
export async function getStoreDetail(pk: number, companyId: number) {
  const store = await getStoreWithLinks(pk, companyId);
  return serializeStoreDetail(store);
}

// Django StoreCreateAPIView.post -> StoreService.create_store
export async function createStore(params: {
  user: User;
  companyId: number;
  data: StoreCreateInput;
}) {
  const { user, companyId, data } = params;

  // Avtorizatsiya route'da `company.stores.manage` (RBAC) orqali. Kompaniya egasi/menejeri yaratadi.
  // StoreCreateSerializer.validate: telefon raqamni tekshirish
  checkValidPhone(data.phone_number);

  const store = await prisma.$transaction(async (tx) => {
    const created = await tx.store.create({
      data: {
        companyId, // tenant-scope: do'kon shu company ostida yaratiladi
        name: data.name_uz,
        nameUzCyrl: data.name_uz_cyrl,
        phoneNumber: data.phone_number,
        address: data.address_uz,
        addressUzCyrl: data.address_uz_cyrl,
        type: data.type,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      },
    });

    // Yaratuvchini (egani) shu do'konga MENEJER sifatida bog'laymiz — shunda u
    // sotuv/inventarizatsiya kabi store-scope amallarni bajara oladi (X-Store-ID).
    // Super admin (companyId yo'q) uchun bog'lamaymiz.
    if (!user.isSuperuser) {
      await tx.storeUser.upsert({
        where: { userId_storeId: { userId: user.id, storeId: created.id } },
        update: { isActive: true, role: 'm' },
        create: { userId: user.id, storeId: created.id, role: 'm', isActive: true },
      });
    }
    return created;
  });

  return serializeStoreResponse(store);
}

// Django StoreDetailAPIView.put -> ModelSerializer(partial=True).save()
export async function updateStore(pk: number, companyId: number, data: StoreUpdateInput) {
  // get_object_or_404 (companyId tekshiruvi bilan — boshqa tenant yozuvi tegmasin)
  await getStoreWithLinks(pk, companyId);

  const updateData: Prisma.StoreUpdateInput = {};
  if (data.name_uz !== undefined) updateData.name = data.name_uz;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl;
  if (data.phone_number !== undefined) updateData.phoneNumber = data.phone_number;
  if (data.address_uz !== undefined) updateData.address = data.address_uz;
  if (data.address_uz_cyrl !== undefined) updateData.addressUzCyrl = data.address_uz_cyrl;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.latitude !== undefined) updateData.latitude = data.latitude;
  if (data.longitude !== undefined) updateData.longitude = data.longitude;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  // companyId tekshirilgan -> id bo'yicha yangilaymiz
  await prisma.store.update({ where: { id: pk }, data: updateData });

  // PUT serializer.data ni qaytaradi (StoreDetailSerializer)
  const refreshed = await getStoreWithLinks(pk, companyId);
  return serializeStoreDetail(refreshed);
}

// Django StoreDetailAPIView.delete -> store.delete()
export async function deleteStore(pk: number, companyId: number) {
  await getStoreWithLinks(pk, companyId);
  await prisma.store.delete({ where: { id: pk } });
}

// Django StoreUserService.attach_user (urls.py'da hozircha kommentlangan, lekin to'liqlik uchun)
export async function attachUser(params: {
  requestUser: User;
  companyId: number;
  userId: number;
  storeId: number;
}) {
  const { requestUser, companyId, userId, storeId } = params;

  // Avtorizatsiya route'da RBAC ruxsati orqali tekshiriladi.
  // 🔴 USER CHECK (UserSelector.get_user: id + is_active=True)
  const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
  if (!user) {
    throw new ValidationError('User topilmadi');
  }

  // 🔴 STORE CHECK — tenant-scope: faqat shu company do'koni
  const store = await prisma.store.findFirst({ where: { id: storeId, companyId } });
  if (!store) {
    throw new ValidationError('Store topilmadi');
  }

  // 🔴 SELF PROTECTION
  if (user.id === requestUser.id) {
    throw new ValidationError('O‘zingizni biriktira olmaysiz');
  }

  // 🔴 DUPLICATE CHECK
  const existing = await prisma.storeUser.findFirst({
    where: { userId: user.id, storeId: store.id },
  });
  if (existing) {
    throw new ValidationError('User allaqachon ushbu storega biriktirilgan');
  }

  // StoreUserRepository.create_store_user -> role = SELLER ('s')
  const storeUser = await prisma.storeUser.create({
    data: { userId: user.id, storeId: store.id, role: 's' },
  });

  return {
    id: storeUser.id,
    user_id: storeUser.userId,
    store_id: storeUser.storeId,
    role: storeUser.role,
  };
}
