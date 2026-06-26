import type { Prisma, PrismaClient, StockTransfer } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { emitToUsers } from '../../realtime/io.js';

// Django: apps/transfer/services/notification_service.py
//
// DB Notification yozuvlarini yaratadi (bulk). Django channels/websocket realtime
// push qiladi (consumers.py: group "user_<id>" -> "notify"); Node tarafda socket.io
// mavjud, LEKIN hozircha realtime DB yozish bilan cheklangan — pastdagi TODO larga
// qarang. Notification.Type: tc/ta/tr (lp/lt boshqa modulga tegishli).
//
// Django: barcha yozuv `transaction.on_commit` ichida ketadi. Node'da bu service
// chaqiruvchi transferService'ning `prisma.$transaction` callbacki ICHIDA, tx client
// bilan chaqiriladi — shu sabab atomic; tx commit bo'lmasa Notification ham yozilmaydi.

type Db = PrismaClient | Prisma.TransactionClient;

export const NOTIFICATION_TYPE = {
  TRANSFER_CREATED: 'tc',
  TRANSFER_APPROVED: 'ta',
  TRANSFER_REJECTED: 'tr',
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPE)[keyof typeof NOTIFICATION_TYPE];

/**
 * Past darajadagi reusable yozuvchi (Django: _send_notifications).
 * Har bir user_id uchun bitta Notification createMany bilan yoziladi.
 *
 * TODO(websocket): commitdan keyin socket.io orqali `user_<id>` xonasiga
 *   { id, title, message, type, transfer_id } push qilish (consumers.py "notify").
 *   Django: `for notif in notifications: channel_layer.group_send("user_<id>", ...)`.
 */
async function sendNotifications(
  db: Db,
  params: {
    companyId: number;
    userIds: number[];
    notifType: NotificationType;
    title: string;
    message: string;
    transferId: number;
  },
): Promise<void> {
  if (params.userIds.length === 0) return;

  await db.notification.createMany({
    data: params.userIds.map((userId) => ({
      companyId: params.companyId,
      userId,
      type: params.notifType,
      title: params.title,
      message: params.message,
      transferId: params.transferId,
    })),
  });

  // socket.io orqali jonli yetkazish (har bir foydalanuvchi `user:<id>` xonasiga)
  emitToUsers(params.userIds, 'notification:new', {
    type: params.notifType,
    title: params.title,
    message: params.message,
    link: null,
    created_at: new Date().toISOString(),
  });
}

type TransferWithStores = StockTransfer & {
  fromStore: { name: string };
  toStore: { name: string };
};

/**
 * Django: notify_transfer_created.
 * to_store faol StoreUser larga "tc" notification.
 */
export async function notifyTransferCreated(
  db: Db,
  transfer: TransferWithStores,
): Promise<void> {
  const storeUsers = await db.storeUser.findMany({
    where: { storeId: transfer.toStoreId, isActive: true },
    select: { userId: true },
  });
  const userIds = [...new Set(storeUsers.map((su) => su.userId))];

  await sendNotifications(db, {
    companyId: transfer.companyId,
    userIds,
    notifType: NOTIFICATION_TYPE.TRANSFER_CREATED,
    title: 'Yangi transfer',
    message: `${transfer.fromStore.name} dan yangi transfer keldi`,
    transferId: transfer.id,
  });
}

/**
 * Django: notify_transfer_rejected.
 * from_store faol StoreUser lari + initiator (created_by) ga "tr" notification.
 */
export async function notifyTransferRejected(
  db: Db,
  transfer: TransferWithStores,
): Promise<void> {
  const storeUsers = await db.storeUser.findMany({
    where: { storeId: transfer.fromStoreId, isActive: true },
    select: { userId: true },
  });
  const userIds = new Set(storeUsers.map((su) => su.userId));

  // initiatorni qo'shamiz
  if (transfer.createdById != null) {
    userIds.add(transfer.createdById);
  }

  await sendNotifications(db, {
    companyId: transfer.companyId,
    userIds: [...userIds],
    notifType: NOTIFICATION_TYPE.TRANSFER_REJECTED,
    title: 'Transfer rad etildi',
    message: `${transfer.toStore.name} transferni rad etdi`,
    transferId: transfer.id,
  });
}
