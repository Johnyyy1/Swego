import { describe, expect, test } from "bun:test";

import { decodeSourceFile } from "./source-file";

const encoder = new TextEncoder();

describe("source file decoding", () => {
  test("accepts normal UTF-8 source code", () => {
    expect(
      decodeSourceFile(encoder.encode("export const value = 42;\n")),
    ).toEqual({
      kind: "text",
      content: "export const value = 42;\n",
    });
  });

  test("accepts empty files without crashing", () => {
    expect(decodeSourceFile(new Uint8Array())).toEqual({
      kind: "text",
      content: "",
    });
  });

  test("rejects a PNG signature without decoding it as text", () => {
    expect(
      decodeSourceFile(
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ kind: "skipped", reason: "binary" });
  });

  test("rejects binary control bytes even without a null byte", () => {
    expect(decodeSourceFile(new Uint8Array([0x01, 0x02, 0x03, 0x04]))).toEqual({
      kind: "skipped",
      reason: "binary",
    });
  });

  test("rejects files containing null bytes", () => {
    expect(
      decodeSourceFile(new Uint8Array([0x74, 0x65, 0x78, 0x74, 0x00, 0x78])),
    ).toEqual({ kind: "skipped", reason: "binary" });
  });

  test("accepts non-ASCII UTF-8 text", () => {
    const content = "const greeting = 'Dobrý den 👋';\n";
    expect(decodeSourceFile(encoder.encode(content))).toEqual({
      kind: "text",
      content,
    });
  });

  test("rejects malformed UTF-8 byte sequences", () => {
    expect(decodeSourceFile(new Uint8Array([0xc3, 0x28]))).toEqual({
      kind: "skipped",
      reason: "non_utf8",
    });
  });
});
