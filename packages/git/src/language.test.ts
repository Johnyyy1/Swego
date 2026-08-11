import { describe, expect, test } from "bun:test";

import { detectLanguage, getFileExtension } from "./language";

describe("file language detection", () => {
  test.each([
    ["src/index.ts", "ts", "TypeScript"],
    ["cmd/server.go", "go", "Go"],
    ["Dockerfile", null, "Dockerfile"],
    ["Makefile", null, "Makefile"],
    ["assets/data.unknown", "unknown", null],
    [".gitignore", null, null],
  ])("detects %s", (path, extension, language) => {
    expect(getFileExtension(path)).toBe(extension);
    expect(detectLanguage(path)).toBe(language);
  });
});
