import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string };
const publicCopy = ["src/components/BountyForgeApp.tsx", "src/components/LandingPage.tsx"]
  .map((file) => readFileSync(resolve(process.cwd(), file), "utf8"))
  .join("\n");

describe("release metadata", () => {
  it("keeps public release labels aligned with the package version", () => {
    const release = packageJson.version.split(".").slice(0, 2).join(".");
    expect(publicCopy).toContain(`release ${release}`);
    expect(publicCopy).not.toContain("release 3.3");
  });
});
