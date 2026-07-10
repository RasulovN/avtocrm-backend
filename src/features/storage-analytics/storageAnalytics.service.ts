import { prisma } from '../../db/prisma.js';
import { scanMedia } from './mediaScan.js';

// ──────────────────────────────────────────────────────────────
// Storage Analytics (super admin) — PostgreSQL hajmi, jadvallar kesimi,
// kompaniyalar bo'yicha taxminiy sarf, media papka hajmi va o'sish dinamikasi.
// Manba: pg katalog jadvallari (pg_stat_user_tables, pg_stat_database),
// storage_snapshot (soatlik snapshot) va assets/media disk skaneri.
// Og'ir so'rovlar xotirada 5 daqiqa keshlanadi.
// ──────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { value: unknown; expires: number }>();

async function cachedResult<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  const value = await loader();
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

const STORAGE_LIMIT_BYTES = Number(process.env.STORAGE_ALERT_LIMIT_GB ?? 50) * 1024 ** 3;

// ───────── DB umumiy holati ─────────

interface DbStatRow {
  size_bytes: number;
  total_tables: number;
  total_rows: number;
  numbackends: number;
  xact_commit: number;
  xact_rollback: number;
  cache_hit_pct: number;
  deadlocks: number;
  temp_files: number;
}

async function databaseStat(): Promise<DbStatRow & { version: string }> {
  const [rows, versionRows] = await Promise.all([
    prisma.$queryRaw<DbStatRow[]>`
      SELECT
        pg_database_size(current_database())::float8                       AS size_bytes,
        (SELECT COUNT(*)::int FROM pg_stat_user_tables)                    AS total_tables,
        (SELECT COALESCE(SUM(n_live_tup), 0)::float8 FROM pg_stat_user_tables) AS total_rows,
        numbackends::int                                                   AS numbackends,
        xact_commit::float8                                                AS xact_commit,
        xact_rollback::float8                                              AS xact_rollback,
        CASE WHEN blks_hit + blks_read = 0 THEN 100
             ELSE ROUND(100.0 * blks_hit / (blks_hit + blks_read), 1)::float8
        END                                                                AS cache_hit_pct,
        deadlocks::int                                                     AS deadlocks,
        temp_files::int                                                    AS temp_files
      FROM pg_stat_database
      WHERE datname = current_database()`,
    prisma.$queryRaw<{ version: string }[]>`SELECT version() AS version`,
  ]);
  return { ...rows[0], version: versionRows[0].version.split(' on ')[0] };
}

// ───────── Jadvallar ro'yxati (pg_stat_user_tables) ─────────

const TABLE_SORT_COLUMNS: Record<string, string> = {
  table_name: 'c.relname',
  rows: 's.n_live_tup',
  dead_rows: 's.n_dead_tup',
  table_bytes: 'pg_relation_size(c.oid)',
  index_bytes: 'pg_indexes_size(c.oid)',
  total_bytes: 'pg_total_relation_size(c.oid)',
};

export interface TableListQuery {
  search?: string;
  sort_by?: string;
  sort_order?: string;
}

interface TableRow {
  table_name: string;
  rows: number;
  dead_rows: number;
  table_bytes: number;
  index_bytes: number;
  total_bytes: number;
  seq_scan: number;
  idx_scan: number;
  last_vacuum: Date | null;
  last_analyze: Date | null;
  total_count: number;
}

export async function listTables(q: TableListQuery, skip: number, take: number) {
  // Sort ustuni qat'iy whitelist orqali — SQL-injection himoyasi
  const sortCol = TABLE_SORT_COLUMNS[q.sort_by ?? ''] ?? 'pg_total_relation_size(c.oid)';
  const sortDir = q.sort_order === 'asc' ? 'ASC' : 'DESC';
  const search = q.search ? `%${q.search}%` : null;

  const rows = await prisma.$queryRawUnsafe<TableRow[]>(
    `SELECT
       c.relname                              AS table_name,
       s.n_live_tup::float8                   AS rows,
       s.n_dead_tup::float8                   AS dead_rows,
       pg_relation_size(c.oid)::float8        AS table_bytes,
       pg_indexes_size(c.oid)::float8         AS index_bytes,
       pg_total_relation_size(c.oid)::float8  AS total_bytes,
       s.seq_scan::float8                     AS seq_scan,
       COALESCE(s.idx_scan, 0)::float8        AS idx_scan,
       GREATEST(s.last_vacuum, s.last_autovacuum)   AS last_vacuum,
       GREATEST(s.last_analyze, s.last_autoanalyze) AS last_analyze,
       COUNT(*) OVER()::int                   AS total_count
     FROM pg_stat_user_tables s
     JOIN pg_class c ON c.oid = s.relid
     WHERE ($1::text IS NULL OR c.relname ILIKE $1)
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $2 OFFSET $3`,
    search,
    take,
    skip,
  );

  const count = rows[0]?.total_count ?? 0;
  return {
    count,
    results: rows.map((r) => ({
      table_name: r.table_name,
      rows: r.rows,
      dead_rows: r.dead_rows,
      table_bytes: r.table_bytes,
      index_bytes: r.index_bytes,
      total_bytes: r.total_bytes,
      seq_scan: r.seq_scan,
      idx_scan: r.idx_scan,
      last_vacuum: r.last_vacuum,
      last_analyze: r.last_analyze,
      // O'lik qatorlar ko'p bo'lsa VACUUM tavsiya qilinadi
      needs_vacuum: r.dead_rows > 1000 && r.dead_rows > r.rows * 0.1,
    })),
  };
}

async function topTables(limit: number) {
  return prisma.$queryRaw<{ table_name: string; total_bytes: number; rows: number }[]>`
    SELECT c.relname AS table_name,
           pg_total_relation_size(c.oid)::float8 AS total_bytes,
           s.n_live_tup::float8 AS rows
    FROM pg_stat_user_tables s
    JOIN pg_class c ON c.oid = s.relid
    ORDER BY pg_total_relation_size(c.oid) DESC
    LIMIT ${limit}`;
}

// ───────── Kompaniyalar bo'yicha taxminiy sarf ─────────
// Har kompaniyaning asosiy jadvallardagi qator soni × o'sha jadvalning
// o'rtacha qator hajmi (pg_total_relation_size / n_live_tup) = taxminiy bayt.

export async function companyUsage() {
  return cachedResult('companies', async () => {
    const rows = await prisma.$queryRaw<
      { id: number; name: string; status: string; total_records: number; estimated_bytes: number }[]
    >`
      WITH sizes AS (
        SELECT c.relname,
               pg_total_relation_size(c.oid)::float8 / GREATEST(s.n_live_tup, 1) AS avg_row_bytes
        FROM pg_stat_user_tables s
        JOIN pg_class c ON c.oid = s.relid
      ),
      counts AS (
                  SELECT company_id, 'users_user' AS tbl, COUNT(*)::float8 AS cnt FROM users_user WHERE company_id IS NOT NULL GROUP BY 1
        UNION ALL SELECT company_id, 'users_customer', COUNT(*) FROM users_customer GROUP BY 1
        UNION ALL SELECT company_id, 'product', COUNT(*) FROM product GROUP BY 1
        UNION ALL SELECT company_id, 'product_batch', COUNT(*) FROM product_batch GROUP BY 1
        UNION ALL SELECT company_id, 'sales_sale', COUNT(*) FROM sales_sale GROUP BY 1
        UNION ALL SELECT company_id, 'sales_payment', COUNT(*) FROM sales_payment GROUP BY 1
        UNION ALL SELECT company_id, 'stock_entry', COUNT(*) FROM stock_entry GROUP BY 1
        UNION ALL SELECT company_id, 'debts_customerdebt', COUNT(*) FROM debts_customerdebt GROUP BY 1
        UNION ALL SELECT company_id, 'stock_transfer', COUNT(*) FROM stock_transfer GROUP BY 1
        UNION ALL SELECT company_id, 'inventory_session', COUNT(*) FROM inventory_session GROUP BY 1
        UNION ALL SELECT company_id, 'audit_log', COUNT(*) FROM audit_log WHERE company_id IS NOT NULL GROUP BY 1
        UNION ALL SELECT company_id, 'notification', COUNT(*) FROM notification WHERE company_id IS NOT NULL GROUP BY 1
        UNION ALL SELECT company_id, 'usage_daily', COUNT(*) FROM usage_daily GROUP BY 1
      )
      SELECT co.id, co.name, co.status,
             COALESCE(SUM(k.cnt), 0)::float8                       AS total_records,
             COALESCE(SUM(k.cnt * z.avg_row_bytes), 0)::float8     AS estimated_bytes
      FROM company co
      LEFT JOIN counts k ON k.company_id = co.id
      LEFT JOIN sizes z ON z.relname = k.tbl
      GROUP BY co.id, co.name, co.status
      ORDER BY estimated_bytes DESC`;
    return rows;
  });
}

// ───────── Snapshot (soatlik job) va o'sish dinamikasi ─────────

export async function takeSnapshot(): Promise<void> {
  try {
    const [db, media, tables] = await Promise.all([databaseStat(), scanMedia(), topTables(20)]);
    await prisma.storageSnapshot.create({
      data: {
        databaseSizeBytes: BigInt(Math.round(db.size_bytes)),
        mediaSizeBytes: BigInt(media.total_bytes),
        mediaFileCount: media.file_count,
        totalRows: BigInt(Math.round(db.total_rows)),
        totalTables: db.total_tables,
        tableStorage: tables.map((t) => ({ table: t.table_name, total_bytes: t.total_bytes, rows: t.rows })),
      },
    });
    // 400 kundan eski snapshotlarni tozalash
    await prisma.$executeRaw`DELETE FROM storage_snapshot WHERE created_at < now() - interval '400 days'`;
  } catch {
    /* snapshot statistika uchun — asosiy oqimni buzmaydi */
  }
}

// Oxirgi soatda snapshot bo'lmasa olish (server qayta ishga tushganda ham chart uzilmasin)
export async function ensureRecentSnapshot(): Promise<void> {
  try {
    const last = await prisma.storageSnapshot.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    if (!last || Date.now() - last.createdAt.getTime() > 3600_000) await takeSnapshot();
  } catch {
    /* keyingi intervalda olinadi */
  }
}

interface GrowthDay {
  date: string;
  db_bytes: number;
  media_bytes: number;
  total_rows: number;
}

export async function getGrowth(days: number) {
  const safeDays = Math.min(Math.max(1, days), 366);
  const series = await prisma.$queryRaw<GrowthDay[]>`
    SELECT DISTINCT ON (((created_at AT TIME ZONE 'Asia/Tashkent')::date))
      (((created_at AT TIME ZONE 'Asia/Tashkent')::date))::text AS date,
      database_size_bytes::float8 AS db_bytes,
      media_size_bytes::float8    AS media_bytes,
      total_rows::float8          AS total_rows
    FROM storage_snapshot
    WHERE created_at >= now() - make_interval(days => ${safeDays}::int)
    ORDER BY ((created_at AT TIME ZONE 'Asia/Tashkent')::date), created_at DESC`;

  // Kunlik o'zgarish (delta) — oldingi kun bilan farq
  const deltas = series.map((d, i) => ({
    date: d.date,
    db_delta: i > 0 ? d.db_bytes - series[i - 1].db_bytes : 0,
    media_delta: i > 0 ? d.media_bytes - series[i - 1].media_bytes : 0,
  }));

  const latest = series[series.length - 1] ?? null;
  const at = (idx: number) => (idx >= 0 && idx < series.length ? series[idx] : null);
  const point = (label: string, prev: GrowthDay | null) => ({
    label,
    delta_bytes: latest && prev ? latest.db_bytes + latest.media_bytes - (prev.db_bytes + prev.media_bytes) : 0,
  });

  return {
    days: safeDays,
    series,
    deltas,
    points: [
      point('day', at(series.length - 2)),
      point('week', at(series.length - 8)),
      point('month', at(series.length - 31)),
    ],
  };
}

// ───────── Tavsiyalar (joy bo'shatish imkoniyatlari) ─────────

export async function getRecommendations() {
  return cachedResult('recommendations', async () => {
    const [unusedIndexes, deadTables, oldAudit, oldVisits] = await Promise.all([
      prisma.$queryRaw<{ index_name: string; table_name: string; bytes: number }[]>`
        SELECT s.indexrelname AS index_name, s.relname AS table_name,
               pg_relation_size(s.indexrelid)::float8 AS bytes
        FROM pg_stat_user_indexes s
        JOIN pg_index i ON i.indexrelid = s.indexrelid
        WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
          AND pg_relation_size(s.indexrelid) > 65536
        ORDER BY bytes DESC LIMIT 10`,
      prisma.$queryRaw<{ table_name: string; dead_rows: number; bytes: number }[]>`
        SELECT relname AS table_name, n_dead_tup::float8 AS dead_rows,
               (pg_total_relation_size(relid) * n_dead_tup / GREATEST(n_live_tup + n_dead_tup, 1))::float8 AS bytes
        FROM pg_stat_user_tables
        WHERE n_dead_tup > 1000 AND n_dead_tup > n_live_tup * 0.1
        ORDER BY bytes DESC LIMIT 10`,
      prisma.$queryRaw<{ cnt: number; bytes: number }[]>`
        SELECT COUNT(*)::float8 AS cnt,
               (COUNT(*) * (SELECT pg_total_relation_size(relid)::float8 / GREATEST(n_live_tup, 1)
                            FROM pg_stat_user_tables WHERE relname = 'audit_log'))::float8 AS bytes
        FROM audit_log WHERE created_at < now() - interval '90 days'`,
      prisma.$queryRaw<{ cnt: number; bytes: number }[]>`
        SELECT COUNT(*)::float8 AS cnt,
               (COUNT(*) * (SELECT pg_total_relation_size(relid)::float8 / GREATEST(n_live_tup, 1)
                            FROM pg_stat_user_tables WHERE relname = 'site_visit'))::float8 AS bytes
        FROM site_visit WHERE created_at < now() - interval '180 days'`,
    ]);

    const recs: { kind: string; target: string; detail: string; estimated_saving_bytes: number }[] = [];

    for (const idx of unusedIndexes) {
      recs.push({
        kind: 'unused_index',
        target: `${idx.table_name}.${idx.index_name}`,
        detail: 'Indeks hech qachon ishlatilmagan (idx_scan = 0)',
        estimated_saving_bytes: idx.bytes,
      });
    }
    for (const t of deadTables) {
      recs.push({
        kind: 'vacuum',
        target: t.table_name,
        detail: `${Math.round(t.dead_rows)} ta o'lik qator — VACUUM tavsiya qilinadi`,
        estimated_saving_bytes: t.bytes,
      });
    }
    if (oldAudit[0] && oldAudit[0].cnt > 0) {
      recs.push({
        kind: 'old_audit_logs',
        target: 'audit_log',
        detail: `90 kundan eski ${Math.round(oldAudit[0].cnt)} ta audit yozuvi`,
        estimated_saving_bytes: oldAudit[0].bytes ?? 0,
      });
    }
    if (oldVisits[0] && oldVisits[0].cnt > 0) {
      recs.push({
        kind: 'old_site_visits',
        target: 'site_visit',
        detail: `180 kundan eski ${Math.round(oldVisits[0].cnt)} ta sayt tashrifi`,
        estimated_saving_bytes: oldVisits[0].bytes ?? 0,
      });
    }

    recs.sort((a, b) => b.estimated_saving_bytes - a.estimated_saving_bytes);
    return {
      total_saving_bytes: recs.reduce((sum, r) => sum + r.estimated_saving_bytes, 0),
      recommendations: recs,
    };
  });
}

// ───────── Dashboard (asosiy sahifa) ─────────

function alertLevel(usedPct: number): 'ok' | 'warning' | 'critical' | 'emergency' {
  if (usedPct >= 95) return 'emergency';
  if (usedPct >= 90) return 'critical';
  if (usedPct >= 80) return 'warning';
  return 'ok';
}

export async function getDashboard() {
  return cachedResult('dashboard', async () => {
    const [db, media, tables, companies, growth] = await Promise.all([
      databaseStat(),
      scanMedia(),
      topTables(8),
      companyUsage(),
      getGrowth(30),
    ]);

    const usedBytes = db.size_bytes + media.total_bytes;
    const usedPct = Math.round((100 * usedBytes) / STORAGE_LIMIT_BYTES);

    return {
      database: {
        size_bytes: db.size_bytes,
        total_tables: db.total_tables,
        total_rows: db.total_rows,
        connections: db.numbackends,
        cache_hit_pct: db.cache_hit_pct,
        deadlocks: db.deadlocks,
        version: db.version,
      },
      media: {
        total_bytes: media.total_bytes,
        file_count: media.file_count,
      },
      alert: {
        level: alertLevel(usedPct),
        used_bytes: usedBytes,
        limit_bytes: STORAGE_LIMIT_BYTES,
        used_pct: usedPct,
      },
      top_tables: tables,
      top_companies: companies.slice(0, 8),
      companies_total: companies.length,
      growth,
    };
  });
}

export async function getFiles() {
  const media = await scanMedia();
  return media;
}
