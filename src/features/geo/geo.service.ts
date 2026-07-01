import type { Country, District, Prisma, Region } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { BadRequest, NotFound } from '../../common/errors.js';
import type {
  CountryCreateInput,
  CountryUpdateInput,
  DistrictCreateInput,
  DistrictUpdateInput,
  RegionCreateInput,
  RegionUpdateInput,
} from './geo.schemas.js';
import { DEFAULT_GEO, type SeedCountry, type SeedRegion } from './geo.seed.data.js';
import { resolveNames } from './geo.translit.js';

// ── Serializatsiya (response snake_case) ─────────────────────

function serializeCountry(c: Country) {
  return {
    id: c.id,
    name: c.name,
    name_uz_cyrl: c.nameUzCyrl,
    name_ru: c.nameRu,
    name_en: c.nameEn,
    code: c.code,
    is_active: c.isActive,
  };
}

function serializeRegion(r: Region) {
  return {
    id: r.id,
    name: r.name,
    name_uz_cyrl: r.nameUzCyrl,
    name_ru: r.nameRu,
    name_en: r.nameEn,
    country_id: r.countryId,
    is_active: r.isActive,
  };
}

function serializeDistrict(d: District) {
  return {
    id: d.id,
    name: d.name,
    name_uz_cyrl: d.nameUzCyrl,
    name_ru: d.nameRu,
    name_en: d.nameEn,
    region_id: d.regionId,
    is_active: d.isActive,
  };
}

// ============================================================
//  COUNTRY
// ============================================================

// PUBLIC: faqat faol davlatlar (onboarding'da tanlash uchun)
export async function listActiveCountries() {
  const countries = await prisma.country.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return countries.map(serializeCountry);
}

// Super admin: barchasi (nofaol ham)
export async function listAllCountries() {
  const countries = await prisma.country.findMany({ orderBy: { name: 'asc' } });
  return countries.map(serializeCountry);
}

export async function createCountry(data: CountryCreateInput) {
  const country = await prisma.country.create({
    data: {
      name: data.name,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      code: data.code ?? null,
      isActive: data.is_active ?? true,
    },
  });
  return serializeCountry(country);
}

export async function updateCountry(id: number, data: CountryUpdateInput) {
  const existing = await prisma.country.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Davlat topilmadi.' });

  const updateData: Prisma.CountryUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl ?? null;
  if (data.name_ru !== undefined) updateData.nameRu = data.name_ru ?? null;
  if (data.name_en !== undefined) updateData.nameEn = data.name_en ?? null;
  if (data.code !== undefined) updateData.code = data.code ?? null;
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  const country = await prisma.country.update({ where: { id }, data: updateData });
  return serializeCountry(country);
}

// FK-himoya: bog'langan region yoki company bo'lsa o'chirib bo'lmaydi
export async function deleteCountry(id: number) {
  const existing = await prisma.country.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Davlat topilmadi.' });

  const [regionCount, companyCount] = await Promise.all([
    prisma.region.count({ where: { countryId: id } }),
    prisma.company.count({ where: { countryId: id } }),
  ]);

  if (regionCount > 0) {
    throw new BadRequest({
      detail: `Bu davlatga ${regionCount} ta viloyat bog'langan. Avval ularni uzing yoki o'chiring.`,
    });
  }
  if (companyCount > 0) {
    throw new BadRequest({
      detail: `Bu davlatga ${companyCount} ta kompaniya bog'langan. Avval ularni uzing yoki boshqa davlatga o'tkazing.`,
    });
  }

  await prisma.country.delete({ where: { id } });
}

// ============================================================
//  REGION
// ============================================================

// PUBLIC: country bo'yicha faol viloyatlar
export async function listActiveRegions(countryId: number) {
  const regions = await prisma.region.findMany({
    where: { isActive: true, countryId },
    orderBy: { name: 'asc' },
  });
  return regions.map(serializeRegion);
}

export async function createRegion(data: RegionCreateInput) {
  // country mavjudligini tekshirish
  const country = await prisma.country.findUnique({ where: { id: data.country_id } });
  if (!country) throw new BadRequest({ detail: 'Tanlangan davlat topilmadi.' });

  const region = await prisma.region.create({
    data: {
      name: data.name,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      countryId: data.country_id,
      isActive: data.is_active ?? true,
    },
  });
  return serializeRegion(region);
}

export async function updateRegion(id: number, data: RegionUpdateInput) {
  const existing = await prisma.region.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Viloyat topilmadi.' });

  if (data.country_id !== undefined) {
    const country = await prisma.country.findUnique({ where: { id: data.country_id } });
    if (!country) throw new BadRequest({ detail: 'Tanlangan davlat topilmadi.' });
  }

  const updateData: Prisma.RegionUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl ?? null;
  if (data.name_ru !== undefined) updateData.nameRu = data.name_ru ?? null;
  if (data.name_en !== undefined) updateData.nameEn = data.name_en ?? null;
  if (data.country_id !== undefined) updateData.country = { connect: { id: data.country_id } };
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  const region = await prisma.region.update({ where: { id }, data: updateData });
  return serializeRegion(region);
}

// FK-himoya: bog'langan district yoki company bo'lsa o'chirib bo'lmaydi
export async function deleteRegion(id: number) {
  const existing = await prisma.region.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Viloyat topilmadi.' });

  const [districtCount, companyCount] = await Promise.all([
    prisma.district.count({ where: { regionId: id } }),
    prisma.company.count({ where: { regionId: id } }),
  ]);

  if (districtCount > 0) {
    throw new BadRequest({
      detail: `Bu viloyatga ${districtCount} ta tuman bog'langan. Avval ularni uzing yoki o'chiring.`,
    });
  }
  if (companyCount > 0) {
    throw new BadRequest({
      detail: `Bu viloyatga ${companyCount} ta kompaniya bog'langan. Avval ularni uzing yoki boshqa viloyatga o'tkazing.`,
    });
  }

  await prisma.region.delete({ where: { id } });
}

// ============================================================
//  DISTRICT
// ============================================================

// PUBLIC: region bo'yicha faol tumanlar
export async function listActiveDistricts(regionId: number) {
  const districts = await prisma.district.findMany({
    where: { isActive: true, regionId },
    orderBy: { name: 'asc' },
  });
  return districts.map(serializeDistrict);
}

export async function createDistrict(data: DistrictCreateInput) {
  const region = await prisma.region.findUnique({ where: { id: data.region_id } });
  if (!region) throw new BadRequest({ detail: 'Tanlangan viloyat topilmadi.' });

  const district = await prisma.district.create({
    data: {
      name: data.name,
      nameUzCyrl: data.name_uz_cyrl ?? null,
      nameRu: data.name_ru ?? null,
      nameEn: data.name_en ?? null,
      regionId: data.region_id,
      isActive: data.is_active ?? true,
    },
  });
  return serializeDistrict(district);
}

export async function updateDistrict(id: number, data: DistrictUpdateInput) {
  const existing = await prisma.district.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Tuman topilmadi.' });

  if (data.region_id !== undefined) {
    const region = await prisma.region.findUnique({ where: { id: data.region_id } });
    if (!region) throw new BadRequest({ detail: 'Tanlangan viloyat topilmadi.' });
  }

  const updateData: Prisma.DistrictUpdateInput = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.name_uz_cyrl !== undefined) updateData.nameUzCyrl = data.name_uz_cyrl ?? null;
  if (data.name_ru !== undefined) updateData.nameRu = data.name_ru ?? null;
  if (data.name_en !== undefined) updateData.nameEn = data.name_en ?? null;
  if (data.region_id !== undefined) updateData.region = { connect: { id: data.region_id } };
  if (data.is_active !== undefined) updateData.isActive = data.is_active;

  const district = await prisma.district.update({ where: { id }, data: updateData });
  return serializeDistrict(district);
}

// FK-himoya: bog'langan company bo'lsa o'chirib bo'lmaydi
export async function deleteDistrict(id: number) {
  const existing = await prisma.district.findUnique({ where: { id } });
  if (!existing) throw new NotFound({ detail: 'Tuman topilmadi.' });

  const companyCount = await prisma.company.count({ where: { districtId: id } });
  if (companyCount > 0) {
    throw new BadRequest({
      detail: `Bu tumanga ${companyCount} ta kompaniya bog'langan. Avval ularni uzing yoki boshqa tumanga o'tkazing.`,
    });
  }

  await prisma.district.delete({ where: { id } });
}

// ============================================================
//  STANDART GEO SEED (davlat -> viloyat -> tuman) — IDEMPOTENT
// ============================================================
// "Standart davlatlarni qo'shish": DEFAULT_GEO ma'lumotini bazaga singdiradi.
//   - Yo'q bo'lsa yaratadi.
//   - Bor bo'lsa (ism/kod bo'yicha topiladi) — yetishmayotgan tarjima (i18n)
//     maydonlarini to'ldiradi, dublikat yaratmaydi.
// Qayta ishga tushirilsa faqat kamchiliklar to'ldiriladi (xavfsiz).

export interface GeoSeedResult {
  countriesCreated: number;
  countriesUpdated: number;
  regionsCreated: number;
  regionsUpdated: number;
  districtsCreated: number;
  districtsUpdated: number;
}

// Nomlarni solishtirish uchun normalizatsiya (bo'sh joy + registrga befarq).
const norm = (s: string): string => s.trim().toLowerCase();

// Viloyat nomini solishtirish uchun: " viloyati"/" respublikasi"/" region"/" oblast"
// qo'shimchalarini olib tashlaymiz — shunda "Andijon viloyati" ↔ "Andijon" mos keladi.
// DIQQAT: " shahri"/" city" OLINMAYDI — "Toshkent viloyati" va "Toshkent shahri"
// alohida bo'lib qolishi kerak.
const normRegion = (s: string): string =>
  norm(s).replace(/\s+(viloyati|respublikasi|region|oblast|province)$/u, '').trim();

// Tuman nomini solishtirish uchun. " tumani"/" tuman"/" rayoni" -> tuman (bazaviy nom).
// " shahri"/" shahar"/" city" -> shahar (alohida marker bilan) — chunki "Qarshi tumani"
// (tuman) va "Qarshi shahri" (shahar) turli ma'muriy birliklar, aralashmasligi kerak.
const normDistrict = (s: string): string => {
  const lower = norm(s);
  const isCity = /\s+(shahri|shahar|city)$/u.test(lower);
  const base = lower.replace(/\s+(tumani|tuman|rayoni|shahri|shahar|city|district)$/u, '').trim();
  return isCity ? `${base} city` : base;
};

// Mavjud yozuvda null bo'lgan i18n maydonlarini seed qiymatlari bilan to'ldiradi.
// O'zgartirish bo'lsa `true` qaytaradi (updated hisoblash uchun).
function fillI18n(
  existing: { nameUzCyrl: string | null; nameRu: string | null; nameEn: string | null },
  seed: { nameUzCyrl?: string; nameRu?: string; nameEn?: string },
  patch: { nameUzCyrl?: string; nameRu?: string; nameEn?: string },
): boolean {
  let changed = false;
  if (!existing.nameUzCyrl && seed.nameUzCyrl) { patch.nameUzCyrl = seed.nameUzCyrl; changed = true; }
  if (!existing.nameRu && seed.nameRu) { patch.nameRu = seed.nameRu; changed = true; }
  if (!existing.nameEn && seed.nameEn) { patch.nameEn = seed.nameEn; changed = true; }
  return changed;
}

async function seedCountryRow(seed: SeedCountry, result: GeoSeedResult): Promise<Country> {
  const orConds: Prisma.CountryWhereInput[] = [
    { name: { equals: seed.name, mode: 'insensitive' } },
  ];
  if (seed.code) orConds.push({ code: seed.code });
  if (seed.nameEn) orConds.push({ nameEn: { equals: seed.nameEn, mode: 'insensitive' } });

  // Yetishmayotgan tillarni lotin nomdan avtomatik to'ldiramiz (4 til).
  const names = resolveNames(seed.name, seed);

  const existing = await prisma.country.findFirst({ where: { OR: orConds } });
  if (!existing) {
    result.countriesCreated += 1;
    return prisma.country.create({
      data: {
        name: seed.name,
        code: seed.code ?? null,
        nameUzCyrl: names.nameUzCyrl,
        nameRu: names.nameRu,
        nameEn: names.nameEn,
      },
    });
  }

  const patch: Prisma.CountryUpdateInput = {};
  const changed = fillI18n(existing, names, patch as Record<string, string>);
  if (!existing.code && seed.code) { patch.code = seed.code; }
  if (changed || (patch.code !== undefined)) {
    result.countriesUpdated += 1;
    return prisma.country.update({ where: { id: existing.id }, data: patch });
  }
  return existing;
}

async function seedRegionRow(
  seed: SeedRegion,
  countryId: number,
  existingByName: Map<string, Region>,
  result: GeoSeedResult,
): Promise<Region> {
  // Yetishmayotgan tillarni lotin nomdan avtomatik to'ldiramiz (4 til).
  const names = resolveNames(seed.name, seed);

  const existing = existingByName.get(normRegion(seed.name));
  if (!existing) {
    result.regionsCreated += 1;
    return prisma.region.create({
      data: {
        name: seed.name,
        nameUzCyrl: names.nameUzCyrl,
        nameRu: names.nameRu,
        nameEn: names.nameEn,
        countryId,
      },
    });
  }

  const patch: Prisma.RegionUpdateInput = {};
  if (fillI18n(existing, names, patch as Record<string, string>)) {
    result.regionsUpdated += 1;
    return prisma.region.update({ where: { id: existing.id }, data: patch });
  }
  return existing;
}

// Mavjud yozuvlarda (davlat/viloyat/tuman) null bo'lgan til maydonlarini
// o'zining lotin `name`idan transliteratsiya qilib to'ldiradi. Bu avval faqat
// o'zbekcha qo'shilgan yozuvlarni ham 4 tilga keltiradi.
async function backfillTranslations(result: GeoSeedResult): Promise<void> {
  const nullCond = {
    OR: [{ nameUzCyrl: null }, { nameRu: null }, { nameEn: null }],
  };

  // Countries
  const countries = await prisma.country.findMany({
    where: nullCond,
    select: { id: true, name: true, nameUzCyrl: true, nameRu: true, nameEn: true },
  });
  for (const c of countries) {
    const names = resolveNames(c.name, c);
    const patch: Prisma.CountryUpdateInput = {};
    if (fillI18n(c, names, patch as Record<string, string>)) {
      await prisma.country.update({ where: { id: c.id }, data: patch });
      result.countriesUpdated += 1;
    }
  }

  // Regions
  const regions = await prisma.region.findMany({
    where: nullCond,
    select: { id: true, name: true, nameUzCyrl: true, nameRu: true, nameEn: true },
  });
  for (const rg of regions) {
    const names = resolveNames(rg.name, rg);
    const patch: Prisma.RegionUpdateInput = {};
    if (fillI18n(rg, names, patch as Record<string, string>)) {
      await prisma.region.update({ where: { id: rg.id }, data: patch });
      result.regionsUpdated += 1;
    }
  }

  // Districts
  const districts = await prisma.district.findMany({
    where: nullCond,
    select: { id: true, name: true, nameUzCyrl: true, nameRu: true, nameEn: true },
  });
  for (const ds of districts) {
    const names = resolveNames(ds.name, ds);
    const patch: Prisma.DistrictUpdateInput = {};
    if (fillI18n(ds, names, patch as Record<string, string>)) {
      await prisma.district.update({ where: { id: ds.id }, data: patch });
      result.districtsUpdated += 1;
    }
  }
}

export async function seedDefaultGeo(): Promise<GeoSeedResult> {
  const result: GeoSeedResult = {
    countriesCreated: 0,
    countriesUpdated: 0,
    regionsCreated: 0,
    regionsUpdated: 0,
    districtsCreated: 0,
    districtsUpdated: 0,
  };

  for (const seedCountry of DEFAULT_GEO) {
    const country = await seedCountryRow(seedCountry, result);

    // Shu davlatning mavjud viloyatlari (bir marta olib, xaritaga solamiz).
    const existingRegions = await prisma.region.findMany({ where: { countryId: country.id } });
    const regionByName = new Map(existingRegions.map((r) => [normRegion(r.name), r]));

    for (const seedRegion of seedCountry.regions) {
      const region = await seedRegionRow(seedRegion, country.id, regionByName, result);

      if (!seedRegion.districts?.length) continue;

      // Mavjud tuman nomlari to'plami — faqat yo'qlarini qo'shamiz (createMany).
      const existingDistricts = await prisma.district.findMany({
        where: { regionId: region.id },
        select: { name: true },
      });
      const districtSet = new Set(existingDistricts.map((d) => normDistrict(d.name)));

      const toCreate = seedRegion.districts
        .filter((d) => !districtSet.has(normDistrict(d.name)))
        .map((d) => {
          // Yetishmayotgan tillarni lotin nomdan avtomatik to'ldiramiz (4 til).
          const names = resolveNames(d.name, d);
          return {
            name: d.name,
            nameUzCyrl: names.nameUzCyrl,
            nameRu: names.nameRu,
            nameEn: names.nameEn,
            regionId: region.id,
          };
        });

      if (toCreate.length) {
        await prisma.district.createMany({ data: toCreate });
        result.districtsCreated += toCreate.length;
      }
    }
  }

  // Mavjud (avvaldan bor) yozuvlardagi yetishmayotgan tillarni ham to'ldiramiz.
  await backfillTranslations(result);

  return result;
}
