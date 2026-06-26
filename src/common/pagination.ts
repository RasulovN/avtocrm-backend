import type { FastifyRequest } from 'fastify';

// Django StandardPagination ekvivalenti:
//   page_size = 20, page_size_query_param = "limit", max_page_size = 100
//   javob: { count, total_pages, current_page, next, previous, results }

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface PageParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export function getPageParams(req: FastifyRequest): PageParams {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
  let limit = parseInt(q.limit ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  limit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

export interface Paginated<T> {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

function buildUrl(req: FastifyRequest, page: number): string {
  const url = new URL(req.url, `${req.protocol}://${req.headers.host ?? 'localhost'}`);
  url.searchParams.set('page', String(page));
  return url.toString();
}

export function paginate<T>(
  req: FastifyRequest,
  results: T[],
  count: number,
  params: PageParams,
): Paginated<T> {
  const totalPages = params.limit ? Math.ceil(count / params.limit) : 1;
  return {
    count,
    total_pages: totalPages,
    current_page: params.page,
    next: params.page < totalPages ? buildUrl(req, params.page + 1) : null,
    previous: params.page > 1 ? buildUrl(req, params.page - 1) : null,
    results,
  };
}
