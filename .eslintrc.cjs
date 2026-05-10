module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: true,
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/strict",
    "plugin:import/typescript",
    "prettier",
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      { prefer: "type-imports", fixStyle: "separate-type-imports" },
    ],
    "@typescript-eslint/no-import-type-side-effects": "error",
    "import/order": [
      "error",
      {
        groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
        alphabetize: { order: "asc" },
        "newlines-between": "always",
      },
    ],
    "no-console": "warn",
    eqeqeq: ["error", "always"],
    curly: ["error", "all"],
  },
  ignorePatterns: ["dist/", "build/", "out/", "node_modules/", "*.config.*", ".eslintrc.cjs"],
  overrides: [
    {
      files: ["packages/aether-frontend/**/*.{ts,tsx}"],
      env: { browser: true },
    },
    {
      files: ["packages/aether-electron/**/*.{ts,tsx}"],
      env: { node: true, browser: true },
    },
    {
      files: ["packages/aether-backend/**/*.ts"],
      env: { node: true },
    },
  ],
};
