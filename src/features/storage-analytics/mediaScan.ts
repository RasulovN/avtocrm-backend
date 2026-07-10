import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, extname } from 'node:path';
import { env } from '../../config/env.js';

// ──────────────────────────────────────────────────────────────
// Media papka (assets/media) disk skaneri — yuklangan fayllar hajmi.
// Rekursiv yuradi; natija 5 daqiqa keshlanadi (katta papkada har so'rovda
// skan qilish qimmat). Xatolar yutiladi — o'qib bo'lmagan fayl o'tkaziladi.
// ──────────────────────────────────────────────────────────────

export interface MediaScanResult {
  total_bytes: number;
  file_count: number;
  dir_count: number;
  by_extension: { extension: string; bytes: number; count: number }[];
  top_dirs: { dir: string; bytes: number; count: number }[];
  scanned_at: string;
}

const CACHE_TTL_MS = 5 * 60_000;
let cached: { result: MediaScanResult; expires: number } | null = null;

async function walk(
  dir: string,
  acc: { bytes: number; files: number; dirs: number; byExt: Map<string, { bytes: number; count: number }> },
): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      acc.dirs += 1;
      await walk(full, acc);
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        acc.bytes += s.size;
        acc.files += 1;
        const ext = (extname(entry.name) || '(kengaytmasiz)').toLowerCase();
        const e = acc.byExt.get(ext) ?? { bytes: 0, count: 0 };
        e.bytes += s.size;
        e.count += 1;
        acc.byExt.set(ext, e);
      } catch {
        /* o'qib bo'lmagan fayl o'tkaziladi */
      }
    }
  }
}

export async function scanMedia(force = false): Promise<MediaScanResult> {
  if (!force && cached && cached.expires > Date.now()) return cached.result;

  const root = join(process.cwd(), env.MEDIA_ROOT);

  // Birinchi daraja papkalar kesimi (qaysi bo'lim qancha joy egallaydi)
  const topDirs: { dir: string; bytes: number; count: number }[] = [];
  const total = { bytes: 0, files: 0, dirs: 0, byExt: new Map<string, { bytes: number; count: number }>() };

  let rootEntries: Dirent[];
  try {
    rootEntries = await readdir(root, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }

  for (const entry of rootEntries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      const sub = { bytes: 0, files: 0, dirs: 0, byExt: total.byExt };
      await walk(full, sub);
      total.bytes += sub.bytes;
      total.files += sub.files;
      total.dirs += sub.dirs + 1;
      topDirs.push({ dir: entry.name, bytes: sub.bytes, count: sub.files });
    } else if (entry.isFile()) {
      try {
        const s = await stat(full);
        total.bytes += s.size;
        total.files += 1;
        const ext = (extname(entry.name) || '(kengaytmasiz)').toLowerCase();
        const e = total.byExt.get(ext) ?? { bytes: 0, count: 0 };
        e.bytes += s.size;
        e.count += 1;
        total.byExt.set(ext, e);
      } catch {
        /* o'tkazildi */
      }
    }
  }

  const result: MediaScanResult = {
    total_bytes: total.bytes,
    file_count: total.files,
    dir_count: total.dirs,
    by_extension: [...total.byExt.entries()]
      .map(([extension, v]) => ({ extension, bytes: v.bytes, count: v.count }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 15),
    top_dirs: topDirs.sort((a, b) => b.bytes - a.bytes).slice(0, 15),
    scanned_at: new Date().toISOString(),
  };

  cached = { result, expires: Date.now() + CACHE_TTL_MS };
  return result;
}
