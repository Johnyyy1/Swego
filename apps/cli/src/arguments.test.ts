import { describe, expect, test } from "bun:test";

import {
  DEFAULT_INGESTION_LIMIT,
  DEFAULT_SEARCH_LIMIT,
  parseCliArguments,
} from "./arguments";

describe("CLI arguments", () => {
  test("parses doctor without a repository target", () => {
    expect(parseCliArguments(["doctor"])).toEqual({ command: "doctor" });
  });

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

  test("parses repository-memory generation", () => {
    expect(
      parseCliArguments([
        "build-memory",
        "123e4567-e89b-42d3-a456-426614174000",
      ]),
    ).toEqual({
      command: "build-memory",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  test("rejects ingestion bounds for repository-memory generation", () => {
    expect(() =>
      parseCliArguments([
        "build-memory",
        "123e4567-e89b-42d3-a456-426614174000",
        "--limit",
        "10",
      ]),
    ).toThrow("do not apply");
  });

  test("parses repository-memory embedding", () => {
    expect(
      parseCliArguments([
        "embed-memory",
        "123e4567-e89b-42d3-a456-426614174000",
      ]),
    ).toEqual({
      command: "embed-memory",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
    });
  });

  test("parses temporally constrained memory search", () => {
    expect(
      parseCliArguments([
        "search",
        "123e4567-e89b-42d3-a456-426614174000",
        "authentication redirect",
        "--before",
        "2025-03-15",
      ]),
    ).toEqual({
      command: "search",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "authentication redirect",
      limit: DEFAULT_SEARCH_LIMIT,
      before: new Date("2025-03-15"),
    });
  });

  test("rejects search without a query", () => {
    expect(() =>
      parseCliArguments(["search", "123e4567-e89b-42d3-a456-426614174000"]),
    ).toThrow("Usage");
  });

  test("parses hybrid search debugging", () => {
    expect(
      parseCliArguments([
        "search",
        "123e4567-e89b-42d3-a456-426614174000",
        "authentication redirect",
        "--debug",
      ]),
    ).toEqual({
      command: "search",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "authentication redirect",
      limit: DEFAULT_SEARCH_LIMIT,
      debug: true,
    });
  });

  test("parses optional local reranking without changing the default", () => {
    expect(
      parseCliArguments([
        "search",
        "123e4567-e89b-42d3-a456-426614174000",
        "session implementation",
        "--rerank",
      ]),
    ).toEqual({
      command: "search",
      repositoryId: "123e4567-e89b-42d3-a456-426614174000",
      query: "session implementation",
      limit: DEFAULT_SEARCH_LIMIT,
      rerank: true,
    });
  });

  test("parses configurable candidate generation bounds", () => {
    expect(
      parseCliArguments([
        "benchmark",
        "benchmarks/formbricks-smoke.json",
        "--rerank",
        "--candidate-limit",
        "75",
        "--path-limit",
        "3",
        "--file-evidence",
        "multi-branch",
      ]),
    ).toEqual({
      command: "benchmark",
      benchmarkFile: "benchmarks/formbricks-smoke.json",
      rerank: true,
      candidateLimit: 75,
      pathLimit: 3,
      fileEvidence: "multi-branch",
    });
  });

  test("rejects invalid candidate generation bounds", () => {
    expect(() =>
      parseCliArguments([
        "benchmark",
        "benchmark.json",
        "--candidate-limit",
        "101",
      ]),
    ).toThrow();
    expect(() =>
      parseCliArguments([
        "benchmark",
        "benchmark.json",
        "--candidate-limit",
        "50",
      ]),
    ).toThrow("requires --rerank");
    expect(() => parseCliArguments(["doctor", "--path-limit", "2"])).toThrow(
      "Usage: swega doctor",
    );
    expect(() =>
      parseCliArguments([
        "benchmark",
        "benchmark.json",
        "--file-evidence",
        "unbounded-sum",
      ]),
    ).toThrow();
  });

  test("rejects hybrid search debugging on other commands", () => {
    expect(() => parseCliArguments(["doctor", "--debug"])).toThrow(
      "Usage: swega doctor",
    );
  });

  test("parses a machine-readable retrieval benchmark", () => {
    expect(
      parseCliArguments([
        "benchmark",
        "benchmarks/formbricks-smoke.json",
        "--json",
        "--rerank",
      ]),
    ).toEqual({
      command: "benchmark",
      benchmarkFile: "benchmarks/formbricks-smoke.json",
      json: true,
      rerank: true,
    });
  });

  test("rejects search options for retrieval benchmarks", () => {
    expect(() =>
      parseCliArguments([
        "benchmark",
        "benchmark.json",
        "--before",
        "2025-03-15",
      ]),
    ).toThrow("Usage: swega benchmark");
  });
});
