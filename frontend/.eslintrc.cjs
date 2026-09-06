module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // API responses (axios) and error handlers are commonly typed loosely across
    // this codebase (e.g. `catch (err: any)`); keep this rule off until the codebase
    // is fully migrated away from explicit `any`.
    '@typescript-eslint/no-explicit-any': 'off',
  },
};
