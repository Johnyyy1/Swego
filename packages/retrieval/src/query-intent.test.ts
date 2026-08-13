import { describe, expect, test } from "bun:test";

import { analyzeQueryIntent } from "./query-intent";

describe("analyzeQueryIntent", () => {
  test.each([
    ["where is authentication implemented", "implementation"],
    ["where are authentication behaviors tested", "tests"],
    ["where is SMTP configured", "configuration"],
    [
      "where is the redirect URL stored in the database schema",
      "database_schema",
    ],
    ["which migration added the user status column", "migration"],
    ["where is the POST endpoint handler", "api_endpoint"],
    ["how are upstream errors mapped", "error_handling"],
    ["why was authentication changed", "history_rationale"],
  ] as const)("infers %s as %s", (query, intent) => {
    expect(
      analyzeQueryIntent(query).some((item) => item.intent === intent),
    ).toBe(true);
  });

  test.each([
    "getProxySession",
    "SurveyModel",
    "src/auth/session.ts",
    "session.ts",
  ])("recognizes exact navigation shape for %s", (query) => {
    expect(analyzeQueryIntent(query)[0]).toMatchObject({
      intent: "exact_symbol",
      confidence: 1,
    });
  });

  test("emits multiple independent signals with transparent evidence", () => {
    const signals = analyzeQueryIntent(
      "where is GitHub authentication configured and tested",
    );

    expect(signals.map((item) => item.intent)).toEqual(
      expect.arrayContaining([
        "tests",
        "configuration",
        "authentication",
        "implementation",
      ]),
    );
    expect(
      signals.every((item) => item.confidence > 0 && item.evidence.length > 0),
    ).toBe(true);
  });

  test("uses a low-confidence general signal for an ambiguous query", () => {
    expect(analyzeQueryIntent("survey behavior")).toEqual([
      {
        intent: "general",
        confidence: 0.25,
        evidence: ["no specific engineering intent signal"],
      },
    ]);
  });

  test("is deterministic", () => {
    const query = "how does authentication error handling work";
    expect(analyzeQueryIntent(query)).toEqual(analyzeQueryIntent(query));
  });
});
