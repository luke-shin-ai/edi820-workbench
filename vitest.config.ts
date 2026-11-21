import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The sandbox has no /etc/hosts, so anything that asks DNS for "localhost"
  // fails. Bind every internal listener to the loopback literal instead.
  server: { host: '127.0.0.1', strictPort: false },
  preview: { host: '127.0.0.1' },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    api: false,
    pool: 'forks',
    reporters: ['default'],
    // PBT runs are deterministic: every property test seeds fast-check explicitly.
    testTimeout: 30_000,
  },
});
