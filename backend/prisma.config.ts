import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: './prisma/schema.prisma',
  generate: {
    client: {
      output: './generated/client'
    }
  }
});