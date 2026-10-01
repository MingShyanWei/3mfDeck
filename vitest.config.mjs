import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/unit/**/*.test.mjs'], environment: 'node', setupFiles: ['tests/unit/setup.mjs'] },
});
