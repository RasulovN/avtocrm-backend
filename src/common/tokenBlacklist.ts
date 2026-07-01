// ─────────────────────────────────────────────
// JWT bekor qilish (revocation) — in-memory jti qora ro'yxati.
// Logout qilinganda access token'ning `jti`si shu yerga qo'shiladi va
// resolveContext har so'rovda tekshiradi. Yozuv token muddati tugagach o'chadi.
//
// CHEKLOV: bir process xotirasida saqlanadi — server qayta ishga tushsa tozalanadi
// va ko'p instansli deploy'da bo'lishilmaydi. To'liq yechim uchun Redis/DB tavsiya
// etiladi, biroq bitta instansda (nginx orqasida) logout'ni ishonchli bajaradi.
// ─────────────────────────────────────────────

interface Entry {
  expiresAt: number; // ms
}

const revoked = new Map<string, Entry>();

let lastSweep = Date.now();
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [jti, entry] of revoked) {
    if (entry.expiresAt <= now) revoked.delete(jti);
  }
}

// jti'ni qora ro'yxatga qo'shadi. expSeconds — token `exp` (unix sekund).
export function revokeToken(jti: string, expSeconds: number): void {
  const now = Date.now();
  sweep(now);
  revoked.set(jti, { expiresAt: expSeconds * 1000 });
}

export function isTokenRevoked(jti: string | undefined): boolean {
  if (!jti) return false;
  const entry = revoked.get(jti);
  if (!entry) return false;
  if (entry.expiresAt <= Date.now()) {
    revoked.delete(jti);
    return false;
  }
  return true;
}
