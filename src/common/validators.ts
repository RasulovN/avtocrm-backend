import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { ValidationError } from './errors.js';

// Django apps/users/validations.py ekvivalentlari

export function checkValidPhone(phoneNumber: string): string {
  const parsed = parsePhoneNumberFromString(phoneNumber);
  if (!parsed || !parsed.isValid()) {
    throw new ValidationError({ error: "Yaroqsiz telefon raqam! (+_)" });
  }
  return phoneNumber;
}

export function checkValidEmail(email: string): boolean {
  const re = /^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$/;
  if (!re.test(email)) {
    throw new ValidationError({ error: 'Invalid email address' });
  }
  return true;
}

export function checkCodeValidator(code: string | number): void {
  const s = String(code);
  if (!/^\d+$/.test(s) || s.length !== 6) {
    throw new ValidationError({ error: 'OTP code is invalid' });
  }
}
