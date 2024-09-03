module.exports = {
    root: true,
    parserOptions: {
      ecmaVersion: 2021,
    },
    env: {
      browser: true,
      node: true,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': 'warn',
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
    },
    globals: {
      // Define any global variables used in your EJS files
      // For example:
      // '$': 'readonly',
      // 'jQuery': 'readonly'
    }
  };