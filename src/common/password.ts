import bcrypt from 'bcryptjs';

// Yangi baza — Django PBKDF2 hashlari ko'chirilmaydi, shuning uchun bcrypt ishlatamiz.

// Cost factor 12 — zamonaviy tavsiya (brute-force'ni qimmatlashtiradi).
const BCRYPT_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function checkPassword(plain: string, hashed: string): Promise<boolean> {
  if (!hashed) return false;
  return bcrypt.compare(plain, hashed);
}
