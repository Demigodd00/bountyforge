import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

describe("responsive layout safeguards", () => {
  it("allows admin cards and long onchain values to shrink inside mobile viewports", () => {
    expect(css).toMatch(/\.admin-grid\s*>\s*\*\s*\{[^}]*min-width:\s*0/);
    expect(css).toMatch(/\.admin-row b,\.admin-row code\s*\{[^}]*min-width:\s*0[^}]*overflow-wrap:\s*anywhere/);
  });
});
