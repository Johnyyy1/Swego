import { describe, expect, test } from "bun:test";

import { DEFAULT_INGESTION_LIMIT, parseCliArguments } from "./arguments";

describe("CLI arguments", () => {
  test("parses bounded GitHub metadata ingestion", () => {
    expect(
      parseCliArguments([
        "ingest",
        "https://github.com/octocat/Hello-World",
        "--limit",
        "25",
        "--since",
        "2025-01-01",
      ]),
    ).toEqual({
      command: "ingest",
      repositoryUrl: "https://github.com/octocat/Hello-World",
      limit: 25,
      since: new Date("2025-01-01"),
    });
  });

  test("parses Git synchronization for a registered repository", () => {
    expect(
      parseCliArguments(["ingest-git", "123e4567-e89b-42d3-a456-426614174000"]),
    ).toEqual({
      command: "ingest-git",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      limit: DEFAULT_INGESTION_LIMIT,
    });
  });

  test("rejects a non-UUID Git synchronization target", () => {
    expect(() => parseCliArguments(["ingest-git", "not-an-id"])).toThrow();
  });
});
