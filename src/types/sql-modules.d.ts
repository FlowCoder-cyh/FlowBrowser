// Sprint 015 M3-1 — vite `?raw` import 지원 (.sql 등 텍스트 파일).
// electron-vite + vitest 둘 다 vite 를 사용하므로 동일하게 처리됨.

declare module '*.sql?raw' {
  const content: string
  export default content
}
