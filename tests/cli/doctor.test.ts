import { describe, expect, it } from "vitest";
import { checkNodeVersion, checkSchool, isNewerVersion } from "../../src/cli/doctor.js";

describe("doctor checks", () => {
  it("accepts Node 20 and newer", () => {
    expect(checkNodeVersion("20.11.0").level).toBe("ok");
    expect(checkNodeVersion("22.3.1").level).toBe("ok");
  });

  it("fails old Node with a fix", () => {
    const result = checkNodeVersion("18.19.0");
    expect(result.level).toBe("fail");
    expect(result.fix).toMatch(/nodejs\.org/);
  });

  it("fails when no school is saved and points at setup", () => {
    expect(checkSchool("").level).toBe("fail");
    expect(checkSchool(null).fix).toMatch(/setup/);
    expect(checkSchool("https://learn.example.edu").level).toBe("ok");
  });

  it("compares versions numerically", () => {
    expect(isNewerVersion("1.10.0", "1.9.0")).toBe(true);
    expect(isNewerVersion("1.1.0", "1.1.0")).toBe(false);
    expect(isNewerVersion("1.0.9", "1.1.0")).toBe(false);
    expect(isNewerVersion("2.0.0-beta.1", "1.9.9")).toBe(true);
  });
});
