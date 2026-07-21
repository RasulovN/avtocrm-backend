import { env, isDev } from '../config/env.js';

// Server xatolari (5xx, crash) haqida Telegram botga avtomatik xabar yuborish.
//
// Ishlash sharti: TELEGRAM_BOT_TOKEN .env'da bo'lishi kerak. TELEGRAM_CHAT_ID
// berilmasa — botga oxirgi yozgan chat getUpdates orqali avtomatik aniqlanadi
// (topilguncha har 60s qayta urinadi; topilgach .env'ga yozish tavsiya etiladi,
// chunki getUpdates tarixi 24 soatdan keyin o'chadi).
//
// Flood himoyasi: xatolar navbatga yig'iladi va 5 soniyada bir marta yuboriladi.
// Matn TG_TEXT_LIMIT (2000 belgi) dan oshsa yoki bir flush'da bir nechta xato
// bo'lsa — bitta .md hujjat sifatida yuboriladi (sendDocument).
//
// Dev rejimda o'chiq (har bir lokal xato botga ketmasin) — TELEGRAM_ALERT_DEV=1
// bilan majburan yoqish mumkin.

const TG_TEXT_LIMIT = 2000;
const FLUSH_INTERVAL_MS = 5_000;
const CHAT_DISCOVER_INTERVAL_MS = 60_000;
const DEDUP_WINDOW_MS = 120_000;

export interface ServerErrorInfo {
  statusCode: number;
  method: string;
  url: string;
  reqId?: string;
  userId?: number | null;
  errorName?: string;
  message: string;
  stack?: string;
}

interface QueuedError extends ServerErrorInfo {
  time: Date;
  count: number;
}

const enabled = Boolean(env.TELEGRAM_BOT_TOKEN) && (!isDev || process.env.TELEGRAM_ALERT_DEV === '1');
const api = (method: string) => `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;

let chatId: string = env.TELEGRAM_CHAT_ID;
const queue: QueuedError[] = [];
// Takror xatolar (bir xil route+xabar) alohida xabar bo'lib ketmasin — count oshiriladi
const recent = new Map<string, { at: number; entry: QueuedError }>();

function now(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

function fmtTime(d: Date): string {
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Tashkent' });
}

async function tgFetch(method: string, body: URLSearchParams | FormData): Promise<void> {
  const res = await fetch(api(method), {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram ${method} ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function sendMessage(text: string): Promise<void> {
  const body = new URLSearchParams({
    chat_id: chatId,
    text,
    disable_web_page_preview: 'true',
  });
  await tgFetch('sendMessage', body);
}

async function sendDocument(filename: string, content: string, caption: string): Promise<void> {
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption.slice(0, 1000));
  form.append('document', new Blob([content], { type: 'text/markdown' }), filename);
  await tgFetch('sendDocument', form);
}

// TELEGRAM_CHAT_ID berilmagan bo'lsa — botga yozgan oxirgi chatni topamiz.
async function discoverChatId(): Promise<boolean> {
  try {
    const res = await fetch(api('getUpdates'), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      ok: boolean;
      result?: Array<{ message?: { chat?: { id: number } } }>;
    };
    const chats = (data.result ?? [])
      .map((u) => u.message?.chat?.id)
      .filter((id): id is number => typeof id === 'number');
    const found = chats.at(-1);
    if (found === undefined) return false;
    chatId = String(found);
    console.warn(
      `[telegram-alert] chat_id avtomatik aniqlandi: ${chatId}. ` +
        `Doimiy bo'lishi uchun .env'ga TELEGRAM_CHAT_ID=${chatId} qo'shib qo'ying.`,
    );
    return true;
  } catch {
    return false;
  }
}

function shortText(e: QueuedError): string {
  const lines = [
    `🔴 ${e.statusCode} — ${e.method} ${e.url}`,
    `⏰ ${fmtTime(e.time)} (${e.count > 1 ? `${e.count} marta` : '1 marta'})`,
    e.reqId ? `🆔 ${e.reqId}${e.userId ? ` | user #${e.userId}` : ''}` : undefined,
    `❌ ${e.errorName ? `${e.errorName}: ` : ''}${e.message}`,
    e.stack ? `\n${e.stack}` : undefined,
  ].filter(Boolean);
  return lines.join('\n');
}

function mdReport(items: QueuedError[]): string {
  const parts = [
    `# Zumex server xato hisoboti`,
    ``,
    `- Server: api.zumex.uz (avtocrm-backend)`,
    `- Vaqt: ${now()}`,
    `- Jami xato: ${items.reduce((s, e) => s + e.count, 0)} ta (${items.length} xil)`,
    ``,
  ];
  items.forEach((e, i) => {
    parts.push(
      `## ${i + 1}) ${e.statusCode} — \`${e.method} ${e.url}\``,
      ``,
      `- Vaqt: ${fmtTime(e.time)}`,
      `- Takror: ${e.count} marta`,
      e.reqId ? `- Request ID: \`${e.reqId}\`` : '',
      e.userId ? `- User: #${e.userId}` : '',
      `- Xato: **${e.errorName ?? 'Error'}** — ${e.message}`,
      ``,
    );
    if (e.stack) {
      parts.push('```', e.stack, '```', '');
    }
  });
  return parts.filter((p) => p !== '').concat('').join('\n');
}

async function flush(): Promise<void> {
  if (!queue.length || !chatId) return;
  const items = queue.splice(0, queue.length);
  try {
    if (items.length === 1) {
      const text = shortText(items[0]);
      if (text.length <= TG_TEXT_LIMIT) {
        await sendMessage(text);
        return;
      }
    }
    const stamp = now().replace(' ', '_').replace(/:/g, '-');
    const total = items.reduce((s, e) => s + e.count, 0);
    await sendDocument(
      `server-errors-${stamp}.md`,
      mdReport(items),
      `🔴 ${total} ta server xatosi — ${items[0].statusCode} ${items[0].method} ${items[0].url}${items.length > 1 ? ` va boshqalar` : ''}`,
    );
  } catch (err) {
    // Telegram ishlamasa ham backend yiqilmasin — faqat logga yozamiz
    console.error('[telegram-alert] yuborilmadi:', (err as Error).message);
  }
}

/** 5xx xato haqida xabar navbatga qo'shiladi (flush 5s da bir marta yuboradi). */
export function notifyServerError(info: ServerErrorInfo): void {
  if (!enabled) return;
  const key = `${info.statusCode}|${info.method}|${info.url.split('?')[0]}|${info.message}`;
  const prev = recent.get(key);
  const t = Date.now();
  if (prev && t - prev.at < DEDUP_WINDOW_MS) {
    prev.entry.count += 1;
    prev.at = t;
    return; // yangi xabar shart emas — mavjudiga hisob qo'shildi
  }
  const entry: QueuedError = { ...info, time: new Date(), count: 1 };
  recent.set(key, { at: t, entry });
  if (recent.size > 200) {
    for (const [k, v] of recent) if (t - v.at > DEDUP_WINDOW_MS) recent.delete(k);
  }
  queue.push(entry);
}

/** Oddiy matnli xabar (ishga tushish, crash va h.k.). Fire-and-forget. */
export async function notifyPlain(text: string): Promise<void> {
  if (!enabled || !chatId) return;
  try {
    if (text.length <= TG_TEXT_LIMIT) await sendMessage(text);
    else {
      const stamp = now().replace(' ', '_').replace(/:/g, '-');
      await sendDocument(`server-log-${stamp}.md`, text, text.slice(0, 200));
    }
  } catch (err) {
    console.error('[telegram-alert] yuborilmadi:', (err as Error).message);
  }
}

/** Backend start paytida chaqiriladi: chat_id aniqlash, flush loop, crash handlerlar. */
export function initTelegramAlerts(): void {
  if (!enabled) {
    if (!env.TELEGRAM_BOT_TOKEN) console.warn('[telegram-alert] TELEGRAM_BOT_TOKEN yo\'q — o\'chiq');
    return;
  }

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  flushTimer.unref();

  const start = async () => {
    if (!chatId) {
      const ok = await discoverChatId();
      if (!ok) {
        console.warn(
          '[telegram-alert] chat_id topilmadi — botga (@zumex_logs_bot) /start yozing ' +
            'yoki .env\'ga TELEGRAM_CHAT_ID qo\'shing. Har 60s qayta tekshiriladi.',
        );
        const retry = setInterval(async () => {
          if (await discoverChatId()) {
            clearInterval(retry);
            await notifyPlain(`✅ Zumex backend ishga tushdi (${now()}) — alert kanali ulandi.`);
          }
        }, CHAT_DISCOVER_INTERVAL_MS);
        retry.unref();
        return;
      }
    }
    await notifyPlain(`🚀 Zumex backend ishga tushdi — ${now()}`);
  };
  void start();

  // Kutilmagan crashlar: xabar yuborishga 3s beriladi, so'ng PM2 qayta ko'taradi.
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException]', err);
    const done = notifyPlain(
      `💥 UNCAUGHT EXCEPTION — backend qayta ishga tushmoqda (${now()})\n\n${err.stack ?? err.message}`,
    );
    void Promise.race([done, new Promise((r) => setTimeout(r, 3_000))]).finally(() =>
      process.exit(1),
    );
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
    void notifyPlain(`⚠️ UNHANDLED REJECTION (${now()})\n\n${msg}`);
  });
}
