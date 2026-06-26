// ============================================================
//  Email HTML shablonlari — brendlangan, professional ko'rinish.
//  Email mijozlari (Gmail/Outlook) uchun: jadval (table) asosidagi
//  tartib + inline stillar (tashqi CSS ko'pincha o'chiriladi).
// ============================================================

const BRAND = 'AutoCRM';
const BRAND_COLOR = '#4f46e5';
const BRAND_COLOR_DARK = '#4338ca';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Brendlangan tashqi qobiq: header + tana + footer.
function brandedShell(opts: { title: string; bodyHtml: string }): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="uz">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <!-- Header -->
          <tr>
            <td style="background:${BRAND_COLOR};background-image:linear-gradient(135deg,${BRAND_COLOR},#6366f1);padding:32px 40px;text-align:center;">
              <span style="display:inline-block;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">${BRAND}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
              <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#475569;">${BRAND}</p>
              <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
                Savdo, ombor va sotuv boshqaruv tizimi<br />
                &copy; ${year} ${BRAND}. Barcha huquqlar himoyalangan.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#cbd5e1;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          Ushbu xat avtomatik yuborilgan, iltimos javob yozmang.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Standart "amal" xati: sarlavha + matn + tugma + zaxira havola + izoh.
export function actionEmailHtml(opts: {
  title: string;
  heading: string;
  intro: string;
  buttonText: string;
  buttonUrl: string;
  fallbackLabel: string;
  footnote: string;
}): string {
  const url = escapeHtml(opts.buttonUrl);
  const body = `
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#0f172a;line-height:1.3;">${escapeHtml(opts.heading)}</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#475569;">${escapeHtml(opts.intro)}</p>
              <!-- Button (bulletproof) -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td align="center" style="border-radius:10px;background:${BRAND_COLOR};box-shadow:0 2px 6px rgba(79,70,229,0.35);">
                    <a href="${url}" target="_blank"
                      style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;border:1px solid ${BRAND_COLOR_DARK};">
                      ${escapeHtml(opts.buttonText)}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#64748b;">${escapeHtml(opts.fallbackLabel)}</p>
              <p style="margin:0 0 28px;font-size:13px;line-height:1.5;word-break:break-all;">
                <a href="${url}" target="_blank" style="color:${BRAND_COLOR};text-decoration:underline;">${url}</a>
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;">
                    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(opts.footnote)}</p>
                  </td>
                </tr>
              </table>`;
  return brandedShell({ title: opts.title, bodyHtml: body });
}

// ── Email tasdiqlash xati ──
export function verificationEmail(opts: { link: string; hours: number }): { html: string; text: string } {
  const html = actionEmailHtml({
    title: 'Email manzilingizni tasdiqlang',
    heading: 'Email manzilingizni tasdiqlang',
    intro: `Assalomu alaykum! ${BRAND} hisobingizni faollashtirish uchun email manzilingizni tasdiqlang. Quyidagi tugmani bosing.`,
    buttonText: 'Emailni tasdiqlash',
    buttonUrl: opts.link,
    fallbackLabel: 'Tugma ishlamasa, quyidagi havolani brauzeringizga nusxalab joylashtiring:',
    footnote: `Havola ${opts.hours} soat davomida amal qiladi. Agar siz ${BRAND}da ro'yxatdan o'tmagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.`,
  });

  const text = `${BRAND} — Email manzilingizni tasdiqlang

Assalomu alaykum! Hisobingizni faollashtirish uchun email manzilingizni tasdiqlang.

Tasdiqlash havolasi:
${opts.link}

Havola ${opts.hours} soat davomida amal qiladi. Agar siz ${BRAND}da ro'yxatdan o'tmagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.

© ${new Date().getFullYear()} ${BRAND}`;

  return { html, text };
}
