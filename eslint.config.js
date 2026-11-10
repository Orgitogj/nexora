import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist", "coverage"] },
  eslint.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config files like this one are plain JS and not part of tsconfig.json.
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ["validation/react-native/**/*.{js,mjs}"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    files: ["validation/react-native/metro.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
