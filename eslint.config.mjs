import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'dist/**',
      'node_modules/**',
      '.flowset/**',
      'docs/**',
      'archive/**',
      'spike/**',
      '**/*.config.{js,ts,mjs,cjs}',
      'vitest.config.ts',
      'electron.vite.config.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks
    },
    languageOptions: {
      globals: { ...globals.browser }
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    },
    settings: {
      react: { version: 'detect' }
    }
  },
  {
    files: ['src/privacy/**/*.ts', 'src/storage/**/*.ts', 'src/ai/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    // Sprint 017 M0 T03 — `.test.tsx` 도 동일 lint override 적용 (renderer React 단위 회귀).
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: {
      globals: { ...globals.node }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
)
