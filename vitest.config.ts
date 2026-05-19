import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      enabled: false
    },
    globals: false,
    pool: 'forks',
    environmentMatchGlobs: [['tests/unit/perception/**', 'happy-dom']],
    // Sprint 016 M0 T06 — bench infra. `npm run perf` 가 본 include 적용.
    // test run (`npm test`) 은 위 include 만 사용 → bench 미실행 (분리).
    benchmark: {
      include: ['tests/perf/**/*.bench.ts'],
      reporters: ['default']
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
