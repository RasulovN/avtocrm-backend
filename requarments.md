cd "backend-node"
npm install
cp .env.example .env      # DATABASE_URL ni PostgreSQL'ga moslang
npm run prisma:migrate    # jadvallar
npm run db:seed           # superuser: +998901234567 / admin12345
npm run dev               # http://localhost:8000
