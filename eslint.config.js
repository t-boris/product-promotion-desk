import js from '@eslint/js'
import tseslint from 'typescript-eslint'

const electronBan = {
  paths: [
    { name: 'electron', message: 'Only src/main, src/preload and src/browser may import Electron (DEC-005, DEC-006).' }
  ]
}

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error'
    }
  },
  {
    // Plain Node scripts (deploy helper) run outside the bundlers.
    files: ['scripts/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } }
  },
  {
    // Core, AI adapters, connectors and shared code must stay testable without Electron.
    files: ['src/core/**', 'src/ai/**', 'src/connectors/**', 'src/shared/**'],
    rules: { 'no-restricted-imports': ['error', electronBan] }
  },
  {
    // The UI talks to the core only through the transport interface (DEC-006).
    files: ['src/renderer/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...electronBan,
          patterns: [{ group: ['**/core/*', '**/ai/*', '**/connectors/*', '**/browser/*', '**/main/*'], message: 'The renderer may import only src/shared.' }]
        }
      ]
    }
  }
)
