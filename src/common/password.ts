import bcrypt from 'bcryptjs';

// Yangi baza — Django PBKDF2 hashlari ko'chirilmaydi, shuning uchun bcrypt ishlatamiz.

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function checkPassword(plain: string, hashed: string): Promise<boolean> {
  if (!hashed) return false;
  return bcrypt.compare(plain, hashed);
}
