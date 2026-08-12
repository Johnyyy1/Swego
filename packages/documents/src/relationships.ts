import { createHash } from "node:crypto";
import { dirname, extname, posix } from "node:path";

import type { RepositoryId, SourceRelationshipType } from "@swega/shared";

import type { GeneratedMemoryDocument } from "./types";
import type { SourceRelationshipExtractor } from "./source-relationships";
import { typeScriptSourceRelationshipExtractor } from "./typescript-relationships";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

export interface SourceRelationship {
  id: string;
  repositoryId: RepositoryId;
  sourceDocumentId: string;
  targetDocumentId: string;
  relationshipType: SourceRelationshipType;
  sourcePath: string;
  targetPath: string;
  sourceSymbol: string | null;
  targetSymbol: string | null;
  language: string;
  sourceCommitSha: string;
  targetCommitSha: string;
  availableAt: Date;
  supersededAt: Date | null;
  provenance: string;
  reason: string;
  sourceStartLine: number;
  confidence: number;
}

export interface RelationshipSourceFile {
  document: GeneratedMemoryDocument;
  content: string;
}

export function extractSourceRelationships(
  files: readonly RelationshipSourceFile[],
  extractor: SourceRelationshipExtractor = typeScriptSourceRelationshipExtractor,
): readonly SourceRelationship[] {
  const byPath = new Map(
    files.flatMap((file) =>
      file.document.document.path
        ? [[file.document.document.path, file] as const]
        : [],
    ),
  );
  const relationships: SourceRelationship[] = [];
  for (const file of files) {
    const source = file.document.document;
    if (!source.path || !source.commitSha) continue;
    let parsed;
    try {
      parsed = extractor.extract({ path: source.path, content: file.content });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to extract source relationships from '${source.path}' with '${extractor.id}': ${detail}`,
        { cause: error },
      );
    }
    if (parsed.status !== "parsed") continue;
    for (const candidate of parsed.relationships) {
      const targetPath = resolveRelativeModule(
        source.path,
        candidate.moduleSpecifier,
        byPath,
      );
      if (!targetPath) continue;
      const target = byPath.get(targetPath)?.document.document;
      if (!target?.commitSha) continue;
      const availableAt =
        source.availableAt > target.availableAt
          ? source.availableAt
          : target.availableAt;
      const identity = [
        source.repositoryId,
        source.id,
        target.id,
        candidate.relationshipType,
        candidate.sourceSymbol ?? "",
        candidate.targetSymbol ?? "",
        candidate.line,
      ].join("\u0000");
      relationships.push({
        id: createHash("sha256")
          .update(`source_relationship_v1\u0000${identity}`)
          .digest("hex"),
        repositoryId: source.repositoryId,
        sourceDocumentId: source.id,
        targetDocumentId: target.id,
        relationshipType: candidate.relationshipType,
        sourcePath: source.path,
        targetPath,
        sourceSymbol: candidate.sourceSymbol,
        targetSymbol: candidate.targetSymbol,
        language: parsed.language,
        sourceCommitSha: source.commitSha,
        targetCommitSha: target.commitSha,
        availableAt,
        supersededAt: null,
        provenance: extractor.id,
        reason: `${candidate.relationshipType} ${candidate.moduleSpecifier}`,
        sourceStartLine: candidate.line,
        confidence: 1,
      });
    }
  }
  return relationships.sort(
    (a, b) =>
      a.sourcePath.localeCompare(b.sourcePath) ||
      a.targetPath.localeCompare(b.targetPath) ||
      a.relationshipType.localeCompare(b.relationshipType) ||
      (a.targetSymbol ?? "").localeCompare(b.targetSymbol ?? "") ||
      a.id.localeCompare(b.id),
  );
}

function resolveRelativeModule(
  sourcePath: string,
  specifier: string,
  files: ReadonlyMap<string, RelationshipSourceFile>,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = posix.normalize(posix.join(dirname(sourcePath), specifier));
  const candidates = new Set<string>([base]);
  if (!extname(base)) {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.add(`${base}${extension}`);
      candidates.add(`${base}/index${extension}`);
    }
  } else if ([".js", ".jsx", ".mjs", ".cjs"].includes(extname(base))) {
    const stem = base.slice(0, -extname(base).length);
    for (const extension of [".ts", ".tsx", ".mts", ".cts"] as const)
      candidates.add(`${stem}${extension}`);
  }
  for (const candidate of candidates)
    if (files.has(candidate)) return candidate;
  return null;
}
