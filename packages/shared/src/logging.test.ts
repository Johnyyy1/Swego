import { describe, expect, spyOn, test } from "bun:test";

import { createJsonLogger } from "./logging";

describe("JSON logger destinations", () => {
  test("routes every MCP-style log level to stderr", () => {
    const stdout = spyOn(console, "log").mockImplementation(() => {});
    const stderr = spyOn(console, "error").mockImplementation(() => {});
    const logger = createJsonLogger(
      { application: "stdio-test" },
      { destination: "stderr" },
    );
    logger.info("server.ready", { count: 1 });
    logger.child({ tool: "test" }).warn("request.failed");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(2);
    expect(stderr.mock.calls[0]?.[0]).toContain('"event":"server.ready"');
    expect(stderr.mock.calls[1]?.[0]).toContain('"tool":"test"');
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
