import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { BadRequest } from '../../common/errors.js';
import { resolveLang } from '../../common/i18n.js';
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  brandWriteSchema,
  productCreateSchema,
  productUpdateSchema,
  batchLocationUpdateSchema,
  locationCreateSchema,
  locationUpdateSchema,
  measurementCreateSchema,
  measurementUpdateSchema,
} from './products.schemas.js';
import {
  listCategories,
  getCategoryDetail,
  createCategory,
  updateCategory,
  deleteCategory,
} from './category.service.js';
import { listBrands, getBrand, createBrand, updateBrand, deleteBrand } from './brand.service.js';
import {
  listProducts,
  getProductDetail,
  createProduct,
  updateProduct,
  deleteProduct,
  type UploadedImage,
} from './product.service.js';
import {
  updateBatchLocation,
  searchProductsByName,
  listLocations,
  getLocation,
  createLocation,
  updateLocation,
  deleteLocation,
  listMeasurements,
  getMeasurement,
  createMeasurement,
  updateMeasurement,
  deleteMeasurement,
  listSalePanelProducts,
} from './batch.service.js';
import { importFromExcel, buildImportTemplate } from './excel.service.js';

// ─────────────────────────────────────────────
// Multipart yordamchi: matn maydonlari + rasm fayllarini ajratadi
// (images, images[], images[N], new_images shaklidagi kalitlarni ushlaydi)
// ─────────────────────────────────────────────
async function parseMultipart(req: FastifyRequest): Promise<{
  fields: Record<string, string>;
  images: UploadedImage[];
}> {
  const fields: Record<string, string> = {};
  const images: UploadedImage[] = [];

  const parts = req.parts();
  for await (const part of parts) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer();
      const field = part.fieldname;
      if (field === 'images' || field.startsWith('images[') || field === 'new_images') {
        images.push({ filename: part.filename, buffer });
      }
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { fields, images };
}

// JSON yoki multipart bo'lsa ham ishlaydigan body olish
async function readBody(
  req: FastifyRequest,
): Promise<{ body: Record<string, unknown>; images: UploadedImage[] }> {
  if (req.isMultipart()) {
    const { fields, images } = await parseMultipart(req);
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      body[k] = v;
    }
    // raqamli maydonlarni coerce qilamiz
    coerceNumber(body, ['category', 'brand', 'unit_measurement', 'min_stock']);
    coerceJsonArray(body, ['delete_image_ids']);
    return { body, images };
  }
  return { body: (req.body as Record<string, unknown>) ?? {}, images: [] };
}

// Category uchun: matn maydonlari + bitta `image` fayl (multipart yoki JSON)
async function readCategoryBody(
  req: FastifyRequest,
): Promise<{ body: Record<string, unknown>; image: UploadedImage | null }> {
  if (!req.isMultipart()) {
    return { body: (req.body as Record<string, unknown>) ?? {}, image: null };
  }
  const body: Record<string, unknown> = {};
  let image: UploadedImage | null = null;
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      if (part.fieldname === 'image') {
        image = { filename: part.filename, buffer: await part.toBuffer() };
      } else {
        await part.toBuffer(); // boshqa fayllarni "drain" qilamiz
      }
    } else {
      body[part.fieldname] = String(part.value);
    }
  }
  return { body, image };
}

function coerceNumber(obj: Record<string, unknown>, keys: string[]): void {
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k] !== '') {
      const n = Number(obj[k]);
      if (!Number.isNaN(n)) obj[k] = n;
    } else if (obj[k] === '') {
      delete obj[k];
    }
  }
}

function coerceJsonArray(obj: Record<string, unknown>, keys: string[]): void {
  for (const k of keys) {
    if (typeof obj[k] === 'string' && obj[k] !== '') {
      try {
        const parsed = JSON.parse(obj[k] as string);
        if (Array.isArray(parsed)) obj[k] = parsed.map((v) => Number(v));
      } catch {
        // qoldiramiz — zod xato beradi
      }
    }
  }
}

// Django apps/products/urls.py bilan AYNAN bir xil path'lar.
// Prefix `/products` modules/index.ts'da beriladi.
export async function productsRoutes(app: FastifyInstance) {
  // Tenant-scope: barcha so'rovlar getCompanyId(req) bo'yicha filtrlanadi.
  // RBAC guard mapping (onRequest):
  //   category : view -> company.categories.view, write -> company.categories.manage
  //   product/batch/location/measurement : view -> company.products.view, write -> company.products.manage
  //   brand    : view -> company.brands.view, write -> company.brands.manage
  const guard = (code: string) => ({
    onRequest: [app.requireCompany, app.requirePermission(code)],
  });

  // ═══════════════════════ Category ═══════════════════════

  // GET categories/ — CategoryListAPIView (search, ordering, pagination)
  app.get('/categories/', guard('company.categories.view'), async (req) => {
    const companyId = getCompanyId(req);
    const q = req.query as Record<string, string | undefined>;
    const page = getPageParams(req);
    const { results, count } = await listCategories({
      companyId,
      search: (q.search ?? '').trim() || null,
      ordering: q.ordering ?? null,
      page,
      lang: resolveLang(req),
    });
    return paginate(req, results, count, page);
  });

  // POST categories/create/ — CategoryCreateAPIView (201). multipart: `image` fayl
  app.post('/categories/create/', guard('company.categories.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const { body, image } = await readCategoryBody(req);
    const data = categoryCreateSchema.parse(body);
    return reply.status(201).send(await createCategory(companyId, data, image, resolveLang(req)));
  });

  // GET categories/:pk/ — CategoryDetailAPIView.get
  app.get('/categories/:pk/', guard('company.categories.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getCategoryDetail(pk, companyId, resolveLang(req));
  });

  // PUT categories/:pk/ — CategoryDetailAPIView.put (partial; Django 201)
  app.put('/categories/:pk/', guard('company.categories.update'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const { body, image } = await readCategoryBody(req);
    const data = categoryUpdateSchema.parse(body);
    return reply.status(201).send(await updateCategory(pk, companyId, data, image, resolveLang(req)));
  });

  // DELETE categories/:pk/ — CategoryDetailAPIView.delete (204)
  app.delete('/categories/:pk/', guard('company.categories.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteCategory(pk, companyId);
    return reply.status(204).send();
  });

  // ═══════════════════════ Product ═══════════════════════

  // GET '' — ProductListAPIView (search, category, is_active, pagination)
  app.get('/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const q = req.query as Record<string, string | undefined>;
    const page = getPageParams(req);
    const { results, count } = await listProducts({
      companyId,
      search: (q.search ?? '').trim() || null,
      category: q.category ? Number(q.category) : null,
      isActive: q.is_active ?? null,
      page,
    });
    return paginate(req, results, count, page);
  });

  // POST create/ — ProductCreateAPIView (multipart: rasmlar; 201)
  app.post('/create/', guard('company.products.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const { body, images } = await readBody(req);
    const data = productCreateSchema.parse(body);
    return reply.status(201).send(await createProduct(companyId, data, images));
  });

  // GET <int:pk>/ — ProductDetailAPIView.get
  app.get('/:pk/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getProductDetail(pk, companyId);
  });

  // PUT <int:pk>/ — ProductDetailAPIView.put (multipart: new_images; 200, string javob)
  app.put('/:pk/', guard('company.products.update'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const { body, images } = await readBody(req);
    const data = productUpdateSchema.parse(body);
    return updateProduct(pk, companyId, data, images);
  });

  // DELETE <int:pk>/ — ProductDetailAPIView.delete (204)
  app.delete('/:pk/', guard('company.products.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteProduct(pk, companyId);
    return reply.status(204).send();
  });

  // ═══════════════════════ Batch / sale panel ═══════════════════════

  // GET item/list/ — ProductBatchListAPIView (sotuv paneli)
  app.get('/item/list/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const q = req.query as Record<string, string | undefined>;
    return listSalePanelProducts({
      user: req.authUser!,
      companyId,
      storeIdParam: q.store ?? null,
      search: (q.search ?? '').trim() || null,
    });
  });

  // PUT item/:pk/ — ProductBatchDetailView.put (faqat location; 200)
  app.put('/item/:pk/', guard('company.products.update'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = batchLocationUpdateSchema.parse(req.body);
    return updateBatchLocation(pk, companyId, body);
  });

  // GET search/:product_name/ — ProductSearchAPIView
  app.get('/search/:product_name/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const productName = (req.params as { product_name: string }).product_name;
    return searchProductsByName(productName, companyId, req.authUser!);
  });

  // ═══════════════════════ Locations ═══════════════════════

  // GET store-product/locations/ — ProductLocationView.get (search, ordering, pagination)
  app.get('/store-product/locations/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const q = req.query as Record<string, string | undefined>;
    const page = getPageParams(req);
    const { results, count } = await listLocations({
      companyId,
      search: (q.search ?? '').trim() || null,
      ordering: q.ordering ?? null,
      page,
      lang: resolveLang(req),
    });
    return paginate(req, results, count, page);
  });

  // POST store-product/locations/ — ProductLocationView.post (201)
  app.post('/store-product/locations/', guard('company.products.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const body = locationCreateSchema.parse(req.body);
    return reply.status(201).send(await createLocation(companyId, body, resolveLang(req)));
  });

  // GET store-product/locations/:pk/ — ProductLocationDetailView.get
  app.get('/store-product/locations/:pk/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getLocation(pk, companyId, resolveLang(req));
  });

  // PUT store-product/locations/:pk/ — ProductLocationDetailView.put (Django 201)
  app.put('/store-product/locations/:pk/', guard('company.products.update'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = locationUpdateSchema.parse(req.body);
    return reply.status(201).send(await updateLocation(pk, companyId, body, resolveLang(req)));
  });

  // DELETE store-product/locations/:pk/ — ProductLocationDetailView.delete (204)
  app.delete('/store-product/locations/:pk/', guard('company.products.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteLocation(pk, companyId);
    return reply.status(204).send();
  });

  // ═══════════════════════ Unit measurements ═══════════════════════

  // GET measurements/ — ProductUnitMeasurementView.get
  app.get('/measurements/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    return listMeasurements(companyId, resolveLang(req));
  });

  // POST measurements/ — ProductUnitMeasurementView.post (201)
  app.post('/measurements/', guard('company.products.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const body = measurementCreateSchema.parse(req.body);
    return reply.status(201).send(await createMeasurement(companyId, body, resolveLang(req)));
  });

  // GET measurements/:pk/ — ProductUnitMeasurementDetailView.get
  app.get('/measurements/:pk/', guard('company.products.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getMeasurement(pk, companyId, resolveLang(req));
  });

  // PUT measurements/:pk/ — ProductUnitMeasurementDetailView.put (Django 201)
  app.put('/measurements/:pk/', guard('company.products.update'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = measurementUpdateSchema.parse(req.body);
    return reply.status(201).send(await updateMeasurement(pk, companyId, body, resolveLang(req)));
  });

  // DELETE measurements/:pk/ — ProductUnitMeasurementDetailView.delete (204)
  app.delete('/measurements/:pk/', guard('company.products.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteMeasurement(pk, companyId);
    return reply.status(204).send();
  });

  // ═══════════════════════ Brand ═══════════════════════

  // GET brand/ — BrandListCreateAPIView.get
  app.get('/brand/', guard('company.brands.view'), async (req) => {
    const companyId = getCompanyId(req);
    return listBrands(companyId);
  });

  // POST brand/ — BrandListCreateAPIView.post (201)
  app.post('/brand/', guard('company.brands.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const body = brandWriteSchema.parse(req.body);
    return reply.status(201).send(await createBrand(companyId, body));
  });

  // GET brand/:pk/ — BrandRetrieveUpdateDestroyAPIView.get
  app.get('/brand/:pk/', guard('company.brands.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getBrand(pk, companyId);
  });

  // PUT brand/:pk/ — BrandRetrieveUpdateDestroyAPIView.put (200)
  app.put('/brand/:pk/', guard('company.brands.update'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const body = brandWriteSchema.parse(req.body);
    return updateBrand(pk, companyId, body);
  });

  // DELETE brand/:pk/ — BrandRetrieveUpdateDestroyAPIView.delete (204)
  app.delete('/brand/:pk/', guard('company.brands.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteBrand(pk, companyId);
    return reply.status(204).send();
  });

  // ═══════════════════════ Excel import / export ═══════════════════════

  // POST products/import/ — ProductImportAPIView (multipart: file)
  app.post('/products/import/', guard('company.products.create'), async (req) => {
    const companyId = getCompanyId(req);
    if (!req.isMultipart()) {
      throw new BadRequest({ detail: 'file maydoni majburiy.' });
    }
    const file = await req.file();
    if (!file) {
      throw new BadRequest({ detail: 'file maydoni majburiy.' });
    }
    if (!file.filename.endsWith('.xlsx')) {
      throw new BadRequest({ detail: 'Faqat .xlsx fayl qabul qilinadi.' });
    }
    const buffer = await file.toBuffer();
    return importFromExcel(companyId, buffer);
  });

  // GET products/import/template/ — ProductImportTemplateAPIView (fayl yuklab olish)
  app.get(
    '/products/import/template/',
    guard('company.products.view'),
    async (_req, reply: FastifyReply) => {
      const buffer = await buildImportTemplate();
      return reply
        .header(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        .header('Content-Disposition', 'attachment; filename="mahsulot_shablon.xlsx"')
        .send(buffer);
    },
  );
}
