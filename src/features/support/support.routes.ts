import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { env } from '../../config/env.js';
import { BadRequest } from '../../common/errors.js';
import { getPageParams, paginate } from '../../common/pagination.js';
import { sendMessageSchema } from './support.schemas.js';
import {
  getMyConversation,
  listMyOlderMessages,
  getMyUnread,
  sendMyMessage,
  listConversations,
  getConversationForAgent,
  listAgentOlderMessages,
  sendAgentMessage,
  setConversationStatus,
  getAgentTotalUnread,
} from './support.service.js';

// Ruxsat etilgan fayl turlari (kengaytma bo'yicha) — rasm va keng tarqalgan hujjatlar.
// DIQQAT: `.svg` va `.html` ATAYIN yo'q — ular skript o'z ichiga olib, media
// domenidan ochilganda saqlangan XSS'ga olib kelishi mumkin.
const ALLOWED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
  '.zip', '.rar', '.mp4', '.mov', '.webm', '.mp3', '.ogg', '.wav',
]);

function safeExt(filename: string): string {
  const ext = extname(filename || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
  return ext;
}

function intParam(req: FastifyRequest, key: string): number {
  const id = Number((req.params as Record<string, string>)[key]);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequest({ detail: 'Noto\'g\'ri identifikator.' });
  return id;
}

function beforeQuery(req: FastifyRequest): number | undefined {
  const raw = (req.query as Record<string, string | undefined>).before;
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function supportRoutes(app: FastifyInstance) {
  // ───────────── Umumiy: fayl yuklash (multipart) ─────────────
  // Bir yoki bir nechta fayl yuboriladi; tavsiflar massivi qaytadi.
  app.post('/upload', { onRequest: app.authenticate }, async (req) => {
    if (!req.isMultipart()) {
      throw new BadRequest({ detail: 'multipart/form-data kutilmoqda.' });
    }

    const yyyymm = new Date().toISOString().slice(0, 7).replace('-', ''); // masalan 202606
    const dir = join(process.cwd(), env.MEDIA_ROOT, 'support', yyyymm);
    await mkdir(dir, { recursive: true });

    const attachments: { url: string; name: string; type: string; size: number }[] = [];
    const parts = req.files();
    for await (const part of parts) {
      const original = part.filename || 'file';
      const ext = safeExt(original);
      // Kengaytmasiz yoki ro'yxatda yo'q fayllar rad etiladi (bo'sh ext bypass'ining oldini oladi).
      if (!ext || !ALLOWED_EXT.has(ext)) {
        throw new BadRequest({ detail: `Ruxsat etilmagan fayl turi: ${ext || '(nomaʼlum)'}` });
      }
      const buf = await part.toBuffer(); // multipart limit (20MB) bu yerda qo'llanadi
      const stored = `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`;
      await writeFile(join(dir, stored), buf);
      attachments.push({
        url: `${env.MEDIA_URL}support/${yyyymm}/${stored}`,
        name: original.slice(0, 255),
        type: part.mimetype || '',
        size: buf.length,
      });
    }

    if (attachments.length === 0) throw new BadRequest({ detail: 'Fayl topilmadi.' });
    return { attachments };
  });

  // ───────────── Foydalanuvchi (kompaniya) tomoni ─────────────
  // Suhbat + oxirgi xabarlar (agar yo'q bo'lsa yaratiladi).
  app.get('/me', { onRequest: app.authenticate }, async (req) =>
    getMyConversation(req.authUser!.id, req.companyId),
  );

  // Eski xabarlar (pagination, ?before=<messageId>).
  app.get('/me/messages', { onRequest: app.authenticate }, async (req) =>
    listMyOlderMessages(req.authUser!.id, beforeQuery(req)),
  );

  // O'qilmagan xabarlar soni (widget badge).
  app.get('/me/unread', { onRequest: app.authenticate }, async (req) => ({
    count: await getMyUnread(req.authUser!.id),
  }));

  // Xabar yuborish.
  app.post('/me/messages', { onRequest: app.authenticate }, async (req) => {
    const body = sendMessageSchema.parse(req.body);
    return sendMyMessage(req.authUser!.id, req.companyId, body);
  });

  // ───────────── Agent (super admin) tomoni ─────────────
  const agentRead = { onRequest: app.requirePermission('platform.support.view') };
  const agentWrite = { onRequest: app.requirePermission('platform.support.manage') };

  // Barcha suhbatlar (status/q filtr + pagination).
  app.get('/conversations', agentRead, async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const page = getPageParams(req);
    const { results, count } = await listConversations({ status: q.status, q: q.q }, page);
    return paginate(req, results, count, page);
  });

  // Operatorlar uchun umumiy o'qilmaganlar (badge).
  app.get('/unread', agentRead, async () => getAgentTotalUnread());

  // Bitta suhbat + xabarlar (foydalanuvchi xabarlari o'qilgan deb belgilanadi).
  app.get('/conversations/:id', agentRead, async (req) =>
    getConversationForAgent(intParam(req, 'id')),
  );

  // Eski xabarlar (pagination).
  app.get('/conversations/:id/messages', agentRead, async (req) =>
    listAgentOlderMessages(intParam(req, 'id'), beforeQuery(req)),
  );

  // Agent javob yozadi.
  app.post('/conversations/:id/messages', agentWrite, async (req) => {
    const body = sendMessageSchema.parse(req.body);
    return sendAgentMessage(req.authUser!.id, intParam(req, 'id'), body);
  });

  // Suhbatni yopish / qayta ochish.
  app.post('/conversations/:id/status', agentWrite, async (req) => {
    const { status } = (req.body ?? {}) as { status?: string };
    if (status !== 'open' && status !== 'closed') {
      throw new BadRequest({ detail: 'status faqat open yoki closed bo\'lishi mumkin.' });
    }
    return setConversationStatus(intParam(req, 'id'), status);
  });
}
