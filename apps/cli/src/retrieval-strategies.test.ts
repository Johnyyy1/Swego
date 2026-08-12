import { describe, expect, test } from "bun:test";

import {
  resolveFileEvidenceStrategy,
  resolveRelationshipExpansionStrategy,
} from "./retrieval-strategies";

describe("configured retrieval strategies", () => {
  test("enables selected file evidence only for the reranker by default", () => {
    expect(resolveFileEvidenceStrategy(undefined, false)).toBe("none");
    expect(resolveFileEvidenceStrategy(undefined, true)).toBe("multi-branch");
  });

  test("honors an explicit approach for reproducible comparisons", () => {
    expect(resolveFileEvidenceStrategy("max", false)).toBe("max");
    expect(resolveFileEvidenceStrategy("none", true)).toBe("none");
  });

  test("keeps bounded relationships opt-in after development diagnostics", () => {
    expect(resolveRelationshipExpansionStrategy(undefined)).toBe("none");
    expect(resolveRelationshipExpansionStrategy("bounded")).toBe("bounded");
    expect(resolveRelationshipExpansionStrategy("none")).toBe("none");
  });
});
