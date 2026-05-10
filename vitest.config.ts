import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.d.ts"],
    },
  },
  resolve: {
    alias: {
      "@aether/types": path.resolve(__dirname, "packages/aether-types/src"),
      "@aether/utils": path.resolve(__dirname, "packages/aether-utils/src"),
      "@aether/core": path.resolve(__dirname, "packages/aether-core/src"),
      "@aether/providers": path.resolve(__dirname, "packages/aether-providers/src"),
      "@aether/orchestrator": path.resolve(__dirname, "packages/aether-orchestrator/src"),
      "@aether/sdk": path.resolve(__dirname, "packages/aether-sdk/src"),
      "@aether/memory": path.resolve(__dirname, "packages/aether-memory/src"),
      "@aether/tools": path.resolve(__dirname, "packages/aether-tools/src"),
      "@aether/backend": path.resolve(__dirname, "packages/aether-backend/src"),
      "@aether/frontend": path.resolve(__dirname, "packages/aether-frontend/src"),
      "@aether/electron": path.resolve(__dirname, "packages/aether-electron/src"),
    },
  },
});
