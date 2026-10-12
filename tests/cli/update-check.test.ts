import { describe, expect, it } from "vitest";
import { shouldCheckForUpdate } from "../../src/cli/update-check.js";

describe("shouldCheckForUpdate", () => {
  it("asks before interactive commands in a terminal", () => {
    expect(shouldCheckForUpdate("setup", [], {}, true)).toBe(true);
    expect(shouldCheckForUpdate("help", [], {}, true)).toBe(true);
  });

  it("never asks when an AI app runs the server or output is piped", () => {
    expect(shouldCheckForUpdate("serve", [], {}, true)).toBe(false);
    expect(shouldCheckForUpdate("config", [], {}, true)).toBe(false);
    expect(shouldCheckForUpdate("setup", [], {}, false)).toBe(false);
  });

  it("respects --yes, CI, the opt-out variable and an already updated run", () => {
    expect(shouldCheckForUpdate("setup", ["--yes"], {}, true)).toBe(false);
    expect(shouldCheckForUpdate("setup", [], { CI: "true" }, true)).toBe(false);
    expect(shouldCheckForUpdate("setup", [], { BRIGHTSPACE_NO_UPDATE_CHECK: "1" }, true)).toBe(false);
    expect(shouldCheckForUpdate("setup", [], { BRIGHTSPACE_UPDATED: "1" }, true)).toBe(false);
  });
});
