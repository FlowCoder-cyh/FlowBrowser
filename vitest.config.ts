import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // Sprint 017 M0 T03 — `.test.tsx` 추가 (renderer React 컴포넌트 회귀 정합).
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      enabled: false
    },
    globals: false,
    pool: 'forks',
    environmentMatchGlobs: [
      ['tests/unit/perception/**', 'happy-dom'],
      // Sprint 017 M0 T03 — renderer React 컴포넌트는 happy-dom 필수.
      ['tests/unit/renderer/**', 'happy-dom']
    ],
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
  },
  // Sprint 017 M0 T03 — renderer JSX automatic 트랜스폼 (tsconfig.web.json `jsx: react-jsx` 정합).
  esbuild: {
    jsx: 'automatic'
  }
})
