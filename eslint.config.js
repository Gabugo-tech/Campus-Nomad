export default [
  {
    ignores: [
      "dist/**/*",
      "node_modules/**/*",
      "vite.config.ts"
    ]
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": "warn",
      "no-console": "off"
    }
  }
];
