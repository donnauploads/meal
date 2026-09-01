module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/apps/web/**', '**/frontend/**'],
            message: 'apps/api must not import from the web/frontend app.',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['dist', 'node_modules', '**/*.js'],
};
