import { describe, it, expect } from "vitest";
import { ApiError, HttpError, RateLimitError, SESSION_EXPIRED_HINT } from "../../src/api/errors.js";
import { SETUP_COMMAND } from "../../src/utils/paths.js";

/**
 * A session that dies mid-chat surfaces as a 401. The person reading it in a
 * chat window cannot inspect status codes, so the message itself has to say
 * which command signs them in again.
 */
describe("an expired-session error", () => {
  it("carries the setup command, not just a 401", () => {
    const error = new ApiError(401, "/d2l/api/lp/1.62/users/whoami", "Brightspace rejected the access token.");

    expect(error.status).toBe(401);
    expect(error.message).toContain("Brightspace rejected the access token.");
    expect(error.message).toContain(SETUP_COMMAND);
    expect(error.message).toBe(
      `[PBMCP-1001] [PBMCP-2001] API error (401) at /d2l/api/lp/1.62/users/whoami: ` +
        `Brightspace rejected the access token. ${SESSION_EXPIRED_HINT}`,
    );
  });

  it("still states the failure when there is no detail to append to", () => {
    const error = new ApiError(401, "/x", "");
    expect(error.message).toBe(`[PBMCP-1001] [PBMCP-2001] API error (401) at /x: ${SESSION_EXPIRED_HINT}`);
  });

  it("does not repeat the command when the message already names it", () => {
    const message = `Session expired. Run \`${SETUP_COMMAND}\` again.`;
    const error = new ApiError(401, "/x", message);

    expect(error.message).toContain(message);
    expect(error.message.match(/setup/g)).toHaveLength(1);
  });

  it("reaches a subclass the same way", () => {
    const error = new HttpError(401, "/x", "rejected");
    expect(error.message).toContain(SETUP_COMMAND);
  });

  it("is left alone on statuses that are not an expired session", () => {
    const plain = new ApiError(404, "/x", "gone");
    expect(plain.message).toBe("[PBMCP-1001] [PBMCP-2001] API error (404) at /x: gone");

    const rateLimited = new RateLimitError("/x", 30);
    expect(rateLimited.message).not.toContain(SETUP_COMMAND);
  });
});
