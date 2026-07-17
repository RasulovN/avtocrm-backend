import type { FastifyInstance } from 'fastify';
import { getPageParams, paginate } from '../../common/pagination.js';
import { getCompanyId } from '../../common/tenant.js';
import { writeOffCreateSchema, writeOffUpdateSchema } from './writeoff.schemas.js';
import {
  listWriteOffs,
  getWriteOffDetail,
  createWriteOff,
  updateWriteOff,
  deleteWriteOff,
} from './writeoff.service.js';

// Django apps/writeoff/urls.py bilan bir xil path'lar.
// Prefix `/writeoff` features/index.ts da beriladi.
export async function writeoffRoutes(app: FastifyInstance) {
  const guard = (code: string) => ({
    onRequest: [app.requireCompany, app.requirePermission(code)],
  });

  // GET list/ — WriteOffListAPIView (store/reason filtr, pagination)
  app.get('/list/', guard('company.writeoff.view'), async (req) => {
    const companyId = getCompanyId(req);
    const q = req.query as Record<string, string | undefined>;
    const page = getPageParams(req);
    const { results, count } = await listWriteOffs({
      companyId,
      store: q.store ? Number(q.store) : null,
      reason: (q.reason ?? '').trim() || null,
      page,
    });
    return paginate(req, results, count, page);
  });

  // POST create/ — WriteOffCreateAPIView (201; stock kamayadi)
  app.post('/create/', guard('company.writeoff.create'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const data = writeOffCreateSchema.parse(req.body);
    const detail = await createWriteOff(companyId, req.authUser!, data);
    return reply.status(201).send(detail);
  });

  // GET <int:pk>/ — WriteOffDetailAPIView.get
  app.get('/:pk/', guard('company.writeoff.view'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    return getWriteOffDetail(pk, companyId);
  });

  // PUT <int:pk>/ — WriteOffDetailAPIView.put (faqat sabab/izoh)
  app.put('/:pk/', guard('company.writeoff.update'), async (req) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    const data = writeOffUpdateSchema.parse(req.body);
    return updateWriteOff(pk, companyId, data);
  });

  // DELETE <int:pk>/ — WriteOffDetailAPIView.delete (204; stock qaytariladi)
  app.delete('/:pk/', guard('company.writeoff.delete'), async (req, reply) => {
    const companyId = getCompanyId(req);
    const pk = Number((req.params as { pk: string }).pk);
    await deleteWriteOff(pk, companyId, req.authUser!);
    return reply.status(204).send();
  });
}
