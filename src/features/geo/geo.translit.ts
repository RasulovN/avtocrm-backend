// ============================================================
//  Geo nomlarini avtomatik transliteratsiya qilish.
//  Seed ma'lumotida ko'p tuman/viloyat faqat o'zbekcha (lotin) nom bilan
//  berilgan. Bu modul yetishmayotgan tillarni (uz-kirill, ruscha ko'rinish,
//  inglizcha) lotin nomdan hosil qiladi — shunda "Standart davlatlarni qo'shish"
//  har bir yozuvni 4 tilda to'ldiradi.
//  DIQQAT: bu avtomatik transliteratsiya (mashina), keyinchalik super admin
//  panelidan qo'lda aniqlashtirish mumkin.
// ============================================================

// Har xil apostrof belgilarini yagona ' ga keltiramiz (o' , g' uchun).
function normalizeApostrophes(s: string): string {
  return s.replace(/[‘’ʻʼ`´]/g, "'");
}

// Satrning birinchi harfini katta qiladi (nom uslubini saqlash uchun).
function capitalizeFirst(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

// ── O'zbek lotin -> o'zbek kirill ──────────────────────────
// Avval digraflar (o', g', sh, ch, yo...) keyin bitta harflar almashtiriladi.
export function toUzCyrillic(input: string): string {
  let s = normalizeApostrophes(input).toLowerCase();

  // Digraflar (uzunroq birikmalar oldin).
  s = s
    .replace(/o'/g, 'ў')
    .replace(/g'/g, 'ғ')
    .replace(/sh/g, 'ш')
    .replace(/ch/g, 'ч')
    .replace(/yo/g, 'ё')
    .replace(/yu/g, 'ю')
    .replace(/ya/g, 'я')
    .replace(/ye/g, 'е')
    .replace(/ts/g, 'ц');

  const map: Record<string, string> = {
    a: 'а', b: 'б', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ж',
    k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с',
    t: 'т', u: 'у', v: 'в', w: 'в', x: 'х', y: 'й', z: 'з', c: 'с',
  };

  let out = '';
  for (const ch of s) {
    if (ch === "'") continue; // tutuq belgisi — tashlab yuboramiz
    out += map[ch] ?? ch;
  }
  return capitalizeFirst(out);
}

// ── O'zbek kirill -> ruscha ko'rinish ──────────────────────
// O'zbekchaga xos harflarni ruscha yaqin ekvivalentlariga almashtiramiz.
export function toRussian(input: string): string {
  const cyr = toUzCyrillic(input);
  const ru = cyr
    .replace(/ў/gi, 'у')
    .replace(/ғ/gi, 'г')
    .replace(/қ/gi, 'к')
    .replace(/ҳ/gi, 'х')
    .replace(/ъ/gi, '');
  return capitalizeFirst(ru);
}

// ── O'zbek lotin -> toza inglizcha (ASCII) ─────────────────
// Apostroflarni olib tashlaymiz: o'->o, g'->g; qolgan harflar lotin bo'lib qoladi.
export function toEnglish(input: string): string {
  const s = normalizeApostrophes(input)
    .replace(/o'/gi, 'o')
    .replace(/g'/gi, 'g')
    .replace(/'/g, '');
  return capitalizeFirst(s);
}

// Seed uchun: berilgan qiymatlar ustun, yo'qlari lotin nomdan hosil qilinadi.
export function resolveNames(
  name: string,
  seed: { nameUzCyrl?: string | null; nameRu?: string | null; nameEn?: string | null },
): { nameUzCyrl: string; nameRu: string; nameEn: string } {
  return {
    nameUzCyrl: seed.nameUzCyrl || toUzCyrillic(name),
    nameRu: seed.nameRu || toRussian(name),
    nameEn: seed.nameEn || toEnglish(name),
  };
}
