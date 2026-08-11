export type SourceFileDecodeResult =
  | { kind: "text"; content: string }
  | { kind: "skipped"; reason: "binary" | "non_utf8" };

export function decodeSourceFile(bytes: Uint8Array): SourceFileDecodeResult {
  if (bytes.some(isBinaryControlByte)) {
    return { kind: "skipped", reason: "binary" };
  }

  try {
    return {
      kind: "text",
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { kind: "skipped", reason: "non_utf8" };
  }
}

function isBinaryControlByte(byte: number): boolean {
  return (
    (byte < 0x20 &&
      byte !== 0x09 &&
      byte !== 0x0a &&
      byte !== 0x0c &&
      byte !== 0x0d) ||
    byte === 0x7f
  );
}
