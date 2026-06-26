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
