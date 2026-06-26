import type { Brand } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { NotFound, ValidationError } from '../../common/errors.js';
import type { BrandWriteInput } from './products.schemas.js';

// BrandSerializer
export function serializeBrand(b: Brand) {
  return {
    id: b.id,
    name: b.name,
  };
}

// BrandSerializer.validate_name: trim + bo'sh emas + iexact uniqueness (instance exclude)
// Uniqueness tekshiruvi tenant doirasida (companyId).
async function validateName(rawName: string, companyId: number, excludeId?: number): Promise<string> {
  const value = rawName.trim();
  if (!value) {
    throw new ValidationError({ name: ["Brand name bo'sh bo'lishi mumkin emas."] });
  }
  const existing = await prisma.brand.findFirst({
    where: {
      companyId,
      name: { equals: value, mode: 'insensitive' },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError({ name: ['Bunday brand mavjud.'] });
  }
  return value;
}

// BrandService.list — tenant-scope
export async function listBrands(companyId: number) {
  // BrandSerializer(many=True). Meta.ordering = ["name"]
  const brands = await prisma.brand.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  return brands.map(serializeBrand);
}

// BrandService.get (get_object_or_404) — tenant-scope
export async function getBrandOr404(pk: number, companyId: number): Promise<Brand> {
  const brand = await prisma.brand.findFirst({ where: { id: pk, companyId } });
  if (!brand) throw new NotFound();
  return brand;
}

export async function getBrand(pk: number, companyId: number) {
  return serializeBrand(await getBrandOr404(pk, companyId));
}

// BrandService.create
export async function createBrand(companyId: number, data: BrandWriteInput) {
  const name = await validateName(data.name, companyId);
  const brand = await prisma.brand.create({ data: { companyId, name } });
  return serializeBrand(brand);
}

// BrandService.update
export async function updateBrand(pk: number, companyId: number, data: BrandWriteInput) {
  const instance = await getBrandOr404(pk, companyId);
  const name = await validateName(data.name, companyId, instance.id);
  const brand = await prisma.brand.update({ where: { id: instance.id }, data: { name } });
  return serializeBrand(brand);
}

// BrandService.delete
export async function deleteBrand(pk: number, companyId: number) {
  await getBrandOr404(pk, companyId);
  await prisma.brand.delete({ where: { id: pk } });
}
