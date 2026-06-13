import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // This project does NOT enable the React Compiler (see README), so the
      // compiler-oriented "rules of React" below flag intentional escape-hatch
      // patterns (live ref mirrors, DOM writes in event handlers, state resets
      // in effects) as errors. Keep them visible as warnings — not blocking —
      // unless/until the React Compiler is adopted.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/immutability': 'warn',
      // Fast Refresh DX hint (mixed component/hook exports), not correctness.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
