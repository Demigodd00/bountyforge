import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Keep this ESM-only test configuration separate from the Next.js build.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    env: { NEXT_PUBLIC_BOUNTYFORGE_ADDRESS: "0x1111111111111111111111111111111111111111" },
    testTimeout: 15000,
  },
});
