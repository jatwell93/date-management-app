const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.organization
  .findMany({ take: 3, select: { id: true, name: true } })
  .then((r: any) => {
    console.log(JSON.stringify(r, null, 2));
    p.$disconnect();
  })
  .catch((e: any) => {
    console.error(e);
    p.$disconnect();
  });
