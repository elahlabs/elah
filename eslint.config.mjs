import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import next from '@next/eslint-plugin-next'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

/**
 * Flat config for the monorepo. Lints the engine packages and the website
 * (framework-agnostic TS + React/TSX). Type-checked rules are intentionally
 * off — they need a project graph and add noise; this is a fast structural
 * lint. Prettier owns formatting (via eslint-config-prettier, applied last),
 * so ESLint never reports stylistic conflicts. Style contract lives in
 * `.prettierrc.json`: 2-space, single quotes, no semicolons.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      'playground/**',
      '**/*.config.{js,mjs,ts}',
      'apps/web/next-env.d.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node scripts (ESM) — give them node globals so `console`/`process` resolve.
  {
    files: ['**/*.{js,mjs,cjs}', 'scripts/**'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Unused vars warn (not error); `_`-prefixed are intentional throwaways.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // React Hooks correctness for the UI surfaces (website + package components).
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/*/src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Next.js rules for the website (also resolves its inline eslint-disable refs).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
    },
  },

  // Tests use fixtures the strict rules misread (definite-assignment `let x!`
  // closure init, deliberately non-yielding hang mocks). Relax there only.
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      'prefer-const': 'off',
      'require-yield': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettier,
)
