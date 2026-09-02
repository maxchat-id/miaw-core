import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ["dist/**", "node_modules/**", "coverage/**", "*.js"],
    },
    {
        // The published CLI executable is plain ESM JavaScript, not TypeScript,
        // so it is not covered by the TS block below and needs Node's globals
        // declared explicitly.
        files: ["bin/**/*.mjs"],
        languageOptions: {
            globals: { console: "readonly", process: "readonly" },
        },
        rules: {
            "no-console": "off",
        },
    },
    {
        files: ["src/**/*.ts", "tests/**/*.ts", "examples/**/*.ts", "bin/**/*.ts"],
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "warn",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-require-imports": "off",
            "no-console": "off",
        },
    }
);
