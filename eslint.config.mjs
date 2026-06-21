import next from "eslint-config-next";

export default [
  ...next,
  {
    ignores: [
      "playwright-report/**",
      "tsconfig.tsbuildinfo",
      "**/*.mjs",
    ],
  },
];
