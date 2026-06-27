import type { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { normalizeContact, type ContactInfo } from '../../common/contact.js';
import type { LandingSettingsInput } from './siteSettings.schemas.js';

const LANDING_KEY = 'landing';

// Zaxira (default) qiymatlar — admin hali tahrir qilmagan bo'lsa shular qaytadi.
// Frontend ham o'zining landingData.json zaxirasiga ega.
export const DEFAULT_LANDING: ContactInfo = {
  phone: '+998 (00) 000-00-00',
  phoneHref: '+998000000000',
  email: 'sales@zumex.uz',
  address: 'Toshkent · sotuv ofisi',
  location: null,
  socials: [
    { name: 'Telegram', url: 'https://t.me/zumex' },
    { name: 'Instagram', url: 'https://instagram.com/zumex' },
    { name: 'Facebook', url: 'https://facebook.com/zumex' },
  ],
};

export async function getLandingSettings(): Promise<ContactInfo> {
  const row = await prisma.siteSetting.findUnique({ where: { key: LANDING_KEY } });
  if (!row) return DEFAULT_LANDING;
  return normalizeContact(row.value, DEFAULT_LANDING);
}

export async function updateLandingSettings(data: LandingSettingsInput): Promise<ContactInfo> {
  const current = await getLandingSettings();
  const merged = normalizeContact({ ...current, ...data }, DEFAULT_LANDING);
  await prisma.siteSetting.upsert({
    where: { key: LANDING_KEY },
    create: { key: LANDING_KEY, value: merged as unknown as Prisma.InputJsonValue },
    update: { value: merged as unknown as Prisma.InputJsonValue },
  });
  return merged;
}
