import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const styleRules = {
  curly: ['error', 'all'],
  'prefer-arrow-callback': 'error',
  'no-restricted-syntax': [
    'error',
    { selector: 'FunctionDeclaration', message: 'Use an arrow function.' },
    {
      selector:
        'FunctionExpression:not([parent.type="MethodDefinition"]):not([parent.method=true]):not([parent.kind="get"]):not([parent.kind="set"])',
      message: 'Use an arrow function; object and class methods are allowed.',
    },
  ],
}

export default defineConfig([
  globalIgnores([
    'build/**',
    'build.new/**',
    '.test-build/**',
    'dist/**',
    'node_modules/**',
  ]),
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      ...styleRules,
      // TypeScript checks names using module imports and browser API types.
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      ...styleRules,
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
])
