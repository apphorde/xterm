import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        Blob: "readonly",
        Buffer: "readonly",
        CSSStyleSheet: "readonly",
        Element: "readonly",
        WebSocket: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        document: "readonly",
        fetch: "readonly",
        location: "readonly",
        navigator: "readonly",
        process: "readonly",
        requestAnimationFrame: "readonly",
        self: "readonly",
        sessionStorage: "readonly",
        window: "readonly",
      },
    },
    rules: {
      curly: ["error", "all"],
    },
  },
  {
    ignores: ["node_modules/**"],
  },
];
