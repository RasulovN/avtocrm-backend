# AutoCRM Backend — Node.js (Fastify + TypeScript + Prisma)

Bu papka Django REST (`../backend`) backend'ining **to'liq Node.js ko'chirmasi**. 
Texnologiyalar: **Fastify 5 + TypeScript + Prisma (PostgreSQL) + zod + JWT (jsonwebtoken)**.

Arxitektura **feature-based** (har bir domen alohida feature papkasi).

## Tuzilma (feature-based architecture)

```
backend-node/
├── prisma/
│   ├── schema.prisma        # Barcha modellar (Django modellaridan ko'chirilgan)
│   └── seed.ts              # Boshlang'ich data (superuser, do'konlar)
├── src/
│   ├── server.ts            # Kirish nuqtasi (listen, graceful shutdown)
│   ├── app.ts               # Fastify instance: plugin va route'larni ulaydi
│   ├── config/
│   │   └── env.ts           # .env o'qish/validatsiya
│   ├── db/
│   │   └── prisma.ts        # PrismaClient singleton
│   ├── plugins/
│   │   ├── auth.ts          # JWT + store-context + guard'lar (authenticate, requireStore, ...)
│   │   └── errorHandler.ts  # DRF uslubidagi xatolik javoblari
│   ├── common/              # Umumiy yordamchilar (shared)
│   │   ├── jwt.ts           # simplejwt-mos token (HS256, user_id claim)
│   │   ├── password.ts      # bcrypt hash/verify
│   │   ├── pagination.ts    # StandardPagination ekvivalenti
│   │   ├── errors.ts        # ApiError, BadRequest, NotFound, ...
│   │   ├── validators.ts    # telefon/email/otp validatsiya
│   │   ├── cookies.ts       # access/refresh cookie
│   │   ├── passwordReset.ts # parol tiklash token (HMAC)
│   │   └── email.ts         # nodemailer (SMTP)
│   └── features/            # ⭐ Har bir Django app — alohida feature
│       ├── index.ts         # Barcha feature route'larini /api ostida ulaydi
│       ├── users/           # auth, user CRUD, profile, customers
│       ├── store/           # do'konlar, store-user
│       ├── products/        # kategoriya, brend, mahsulot, partiya, barcode, excel
│       ├── contract/        # ta'minotchilar, kirim (stock entry), to'lovlar
│       ├── inventory/       # inventarizatsiya, snapshot, hisob, low-stock + hooks
│       ├── sales/           # sotuv, qaytarish, to'lov, qarzdor mijozlar
│       ├── debts/           # mijoz qarzlari
│       ├── transfer/        # do'konlararo ko'chirish, bildirishnomalar
│       └── reports/         # dashboard, grafiklar, hisobotlar, excel export
```

Har bir feature ichida: `*.routes.ts` (endpointlar), `*.service.ts` (biznes-logika), `*.schemas.ts` (zod validatsiya).

## Ishga tushirish

```bash
# 1. Bog'liqliklar
npm install

# 2. .env tayyorlash
cp .env.example .env
# .env ichida DATABASE_URL ni o'z PostgreSQL'ingizga moslang

# 3. Bazani yaratish va migratsiya
npm run prisma:migrate     # dev migration (jadvallarni yaratadi)
# yoki mavjud bazaga: npm run prisma:deploy

# 4. (ixtiyoriy) Boshlang'ich data
npm run db:seed            # superuser: +998901234567 / admin12345

# 5. Dev rejimda ishga tushirish
npm run dev                # http://localhost:8000

# Production
npm run build && npm start
```

## API

- Base URL: `/api`
- Swagger / OpenAPI: `GET /api/docs`
- Health: `GET /health`

Route'lar Django `apps/urls.py` bilan **bir xil** path'larda (masalan `POST /api/users/login/`, `GET /api/products/`).

## Autentifikatsiya (Django bilan mos)

- **JWT** (HS256, `SECRET_KEY` bilan imzolanadi, `user_id` claim) — `rest_framework_simplejwt` bilan mos.
- Token **cookie** (`access_token`) yoki **`Authorization: Bearer <token>`** orqali yuboriladi.
- `POST /api/users/login/` access+refresh tokenlarni cookie sifatida o'rnatadi va body'da ham qaytaradi.
- **Multi-tenancy**: himoyalangan endpointlarga `X-Store-ID` header yuboriladi → `StoreUser` aniqlanadi (`request.store` / `request.storeUser`).

### Guard'lar (DRF permission ekvivalentlari)
| Node | Django |
|------|--------|
| `app.authenticate` | `IsAuthenticated` |
| `app.requireSuperuser` | `IsSuperUser` |
| `app.requireStore` | `IsStoreMember` (X-Store-ID majburiy) |
| `app.requireSeller` | `IsSeller` |

## Ko'chirishdagi muhim qarorlar

- **Parol**: yangi baza bo'lgani uchun Django PBKDF2 hashlari ko'chirilmadi — `bcrypt` ishlatiladi. Eski parollar ishlamaydi, yangi user/seed yarating.
- **Pagination javobi** DRF bilan bir xil: `{ count, total_pages, current_page, next, previous, results }` (`?page=`, `?limit=`).
- **Decimal** maydonlar JSON'da string sifatida qaytadi (DRF `DecimalField` kabi).
- **Tarjima** (django-modeltranslation): tarjimali maydonlar uchun `*UzCyrl` ustunlari saqlangan (`nameUzCyrl`, `addressUzCyrl`, ...).
- **Barcode**: `bwip-js` bilan EAN-13 generatsiya (`python-barcode` o'rniga). Rasm `assets/media/` ostida.
- **Excel**: `exceljs` (import/export).
- **WebSocket** (Django Channels): hozircha bildirishnomalar **DB'ga yoziladi**; realtime push (`socket.io`) keyingi bosqich uchun TODO sifatida qoldirilgan.

## Skriptlar

| Skript | Vazifa |
|--------|--------|
| `npm run dev` | tsx watch bilan dev server |
| `npm run build` | TypeScript → `dist/` |
| `npm start` | `dist/server.js` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | dev migratsiya |
| `npm run prisma:deploy` | prod migratsiya |
| `npm run prisma:studio` | Prisma Studio (DB GUI) |
| `npm run db:seed` | boshlang'ich data |
# avtocrm-backend
