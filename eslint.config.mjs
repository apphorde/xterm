import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        Blob: "readonly",
        Buffer: "readonly",
        ArrayBuffer: "readonly",
        WeakRef: "readonly",
        CSSStyleSheet: "readonly",
        CustomEvent: "readonly",
        Element: "readonly",
        WebSocket: "readonly",
        TextDecoder: "readonly",
        URL: "readonly",
        document: "readonly",
        fetch: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        crypto: "readonly",
        location: "readonly",
        navigator: "readonly",
        process: "readonly",
        requestAnimationFrame: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
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
