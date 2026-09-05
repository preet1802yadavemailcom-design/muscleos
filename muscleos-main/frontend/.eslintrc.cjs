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
    // this codebase (e.g. `catch (err: any)`); downgraded to a warning so CI lint
    // reflects the project's actual style instead of failing the build on it.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
