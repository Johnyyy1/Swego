import { createHash } from "node:crypto";

import type {
  RepositoryId,
  SourceRelationshipType,
  SourceSymbolKind,
} from "@swega/shared";

import type {
  ParsedSourceExport,
  ParsedSourceRelationship,
  SourceRelationshipBindingKind,
  SourceRelationshipExtractor,
  SourceRelationshipParseResult,
} from "./source-relationships";
import {
  type ModuleResolutionKind,
  TypeScriptProjectResolver,
} from "./typescript-config";
import { typeScriptSourceRelationshipExtractor } from "./typescript-relationships";
import type { GeneratedMemoryDocument, MemoryDocumentChunk } from "./types";

export type SourceRelationshipResolution = "exact_symbol" | "exact_module";

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
  importedName: string | null;
  localName: string | null;
  exposedName: string | null;
  bindingKind: SourceRelationshipBindingKind;
  isTypeOnly: boolean;
  resolution: SourceRelationshipResolution;
  moduleResolutionKind: ModuleResolutionKind;
  targetSymbolKind: SourceSymbolKind | null;
  targetStartLine: number | null;
  targetEndLine: number | null;
  configurationPath: string | null;
  configurationCommitSha: string | null;
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

export interface SourceRelationshipDiagnostics {
  parsedBindings: number;
  externalBindings: number;
  relativeBindings: number;
  pathAliasBindings: number;
  baseUrlBindings: number;
  resolvedRelativeBindings: number;
  resolvedPathAliasBindings: number;
  resolvedBaseUrlBindings: number;
  resolvedRelationships: number;
  unresolvedLocalBindings: number;
  ambiguousLocalBindings: number;
  exactSymbolRelationships: number;
  exactModuleRelationships: number;
  symbolBearingRelationships: number;
  importsRelationships: number;
  reexportsRelationships: number;
  configurationFiles: number;
  configurationFailures: number;
}

export interface SourceRelationshipExtraction {
  relationships: readonly SourceRelationship[];
  diagnostics: SourceRelationshipDiagnostics;
}

interface ParsedFile {
  file: RelationshipSourceFile;
  parsed: Extract<SourceRelationshipParseResult, { status: "parsed" }>;
}

interface ExactTarget {
  symbol: string;
  kind: SourceSymbolKind;
  startLine: number;
  endLine: number;
}

export function extractSourceRelationships(
  files: readonly RelationshipSourceFile[],
  extractor: SourceRelationshipExtractor = typeScriptSourceRelationshipExtractor,
): readonly SourceRelationship[] {
  return extractSourceRelationshipsWithDiagnostics(files, extractor)
    .relationships;
}

export function extractSourceRelationshipsWithDiagnostics(
  files: readonly RelationshipSourceFile[],
  extractor: SourceRelationshipExtractor = typeScriptSourceRelationshipExtractor,
): SourceRelationshipExtraction {
  const relationships: SourceRelationship[] = [];
  const diagnostics = emptyDiagnostics();
  const filesByRepository = groupByRepository(files);
  for (const repositoryFiles of filesByRepository.values()) {
    const byPath = new Map(
      repositoryFiles.flatMap((file) =>
        file.document.document.path
          ? [[file.document.document.path, file] as const]
          : [],
      ),
    );
    const parsedFiles = parseFiles(repositoryFiles, extractor);
    const parsedByPath = new Map(
      parsedFiles.map((parsed) => [parsed.file.document.document.path, parsed]),
    );
    const resolver = new TypeScriptProjectResolver(byPath);

    for (const parsedFile of parsedFiles) {
      const source = parsedFile.file.document.document;
      if (!source.path || !source.commitSha) continue;
      for (const candidate of parsedFile.parsed.relationships) {
        diagnostics.parsedBindings += 1;
        const resolved = resolver.resolve(
          source.path,
          candidate.moduleSpecifier,
        );
        if (resolved.status === "external") {
          diagnostics.externalBindings += 1;
          continue;
        }
        incrementModuleResolutionCount(diagnostics, resolved.kind);
        if (resolved.status === "unresolved") {
          diagnostics.unresolvedLocalBindings += 1;
          continue;
        }
        if (resolved.status === "ambiguous") {
          diagnostics.ambiguousLocalBindings += 1;
          continue;
        }
        const targetFile = byPath.get(resolved.path);
        const target = targetFile?.document.document;
        if (!targetFile || !target?.commitSha) continue;
        incrementResolvedModuleCount(diagnostics, resolved.kind);
        const exactTarget = findExactTarget(
          candidate,
          parsedByPath.get(resolved.path),
        );
        const resolution: SourceRelationshipResolution = exactTarget
          ? "exact_symbol"
          : "exact_module";
        diagnostics.resolvedRelationships += 1;
        if (resolution === "exact_symbol") {
          diagnostics.exactSymbolRelationships += 1;
        } else {
          diagnostics.exactModuleRelationships += 1;
        }
        if (candidate.importedName) diagnostics.symbolBearingRelationships += 1;
        if (candidate.relationshipType === "imports") {
          diagnostics.importsRelationships += 1;
        } else {
          diagnostics.reexportsRelationships += 1;
        }

        const availableAt = latestDate([
          source.availableAt,
          target.availableAt,
          ...resolved.configurationFiles.map(
            (config) => config.document.document.availableAt,
          ),
        ]);
        const identity = [
          source.repositoryId,
          source.id,
          target.id,
          candidate.relationshipType,
          candidate.importedName ?? "",
          candidate.localName ?? "",
          candidate.exposedName ?? "",
          candidate.bindingKind,
          Number(candidate.isTypeOnly),
          resolution,
          resolved.kind,
          candidate.line,
        ].join("\u0000");
        relationships.push({
          id: createHash("sha256")
            .update(`source_relationship_v2\u0000${identity}`)
            .digest("hex"),
          repositoryId: source.repositoryId,
          sourceDocumentId: source.id,
          targetDocumentId: target.id,
          relationshipType: candidate.relationshipType,
          sourcePath: source.path,
          targetPath: resolved.path,
          sourceSymbol: candidate.sourceSymbol,
          targetSymbol: exactTarget?.symbol ?? null,
          importedName: candidate.importedName,
          localName: candidate.localName,
          exposedName: candidate.exposedName,
          bindingKind: candidate.bindingKind,
          isTypeOnly: candidate.isTypeOnly,
          resolution,
          moduleResolutionKind: resolved.kind,
          targetSymbolKind: exactTarget?.kind ?? null,
          targetStartLine: exactTarget?.startLine ?? null,
          targetEndLine: exactTarget?.endLine ?? null,
          configurationPath: resolved.configurationPath,
          configurationCommitSha: resolved.configurationCommitSha,
          language: parsedFile.parsed.language,
          sourceCommitSha: source.commitSha,
          targetCommitSha: target.commitSha,
          availableAt,
          supersededAt: null,
          provenance: extractor.id,
          reason: `${candidate.relationshipType} ${candidate.moduleSpecifier} (${resolved.kind}, ${resolution})`,
          sourceStartLine: candidate.line,
          confidence: 1,
        });
      }
    }
    const configDiagnostics = resolver.diagnostics();
    diagnostics.configurationFiles += configDiagnostics.configurationFiles;
    diagnostics.configurationFailures +=
      configDiagnostics.configurationFailures;
  }
  return {
    relationships: relationships.sort(compareRelationships),
    diagnostics,
  };
}

function parseFiles(
  files: readonly RelationshipSourceFile[],
  extractor: SourceRelationshipExtractor,
): readonly ParsedFile[] {
  return files.flatMap((file) => {
    const path = file.document.document.path;
    if (!path) return [];
    let parsed: SourceRelationshipParseResult;
    try {
      parsed = extractor.extract({ path, content: file.content });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to extract source relationships from '${path}' with '${extractor.id}': ${detail}`,
        { cause: error },
      );
    }
    return parsed.status === "parsed" ? [{ file, parsed }] : [];
  });
}

function findExactTarget(
  relationship: ParsedSourceRelationship,
  parsedTarget: ParsedFile | undefined,
): ExactTarget | null {
  if (!relationship.importedName || !parsedTarget) return null;
  const exported = uniqueExport(
    parsedTarget.parsed.exports,
    relationship.importedName,
  );
  if (!exported) return null;
  const chunks = parsedTarget.file.document.chunks.filter(
    (chunk) =>
      chunk.parentSymbol === null &&
      chunk.symbolName === exported.localName &&
      chunk.symbolId !== null &&
      chunk.symbolKind !== null &&
      chunk.startLine !== null &&
      chunk.endLine !== null,
  );
  const symbolIds = new Set(chunks.map((chunk) => chunk.symbolId));
  if (chunks.length === 0 || symbolIds.size !== 1) return null;
  return summarizeSymbol(chunks);
}

function uniqueExport(
  exports: readonly ParsedSourceExport[],
  exportedName: string,
): ParsedSourceExport | null {
  const matches = exports.filter(
    (candidate) => candidate.exportedName === exportedName,
  );
  const locals = new Set(matches.map((candidate) => candidate.localName));
  return matches.length > 0 && locals.size === 1 ? matches[0]! : null;
}

function summarizeSymbol(chunks: readonly MemoryDocumentChunk[]): ExactTarget {
  const first = chunks[0]!;
  return {
    symbol: first.symbolName!,
    kind: first.symbolKind!,
    startLine: Math.min(...chunks.map((chunk) => chunk.startLine!)),
    endLine: Math.max(...chunks.map((chunk) => chunk.endLine!)),
  };
}

function groupByRepository(
  files: readonly RelationshipSourceFile[],
): ReadonlyMap<RepositoryId, readonly RelationshipSourceFile[]> {
  const grouped = new Map<RepositoryId, RelationshipSourceFile[]>();
  for (const file of files) {
    const repositoryId = file.document.document.repositoryId;
    const current = grouped.get(repositoryId) ?? [];
    current.push(file);
    grouped.set(repositoryId, current);
  }
  return grouped;
}

function latestDate(dates: readonly Date[]): Date {
  return new Date(Math.max(...dates.map((date) => date.getTime())));
}

function incrementModuleResolutionCount(
  diagnostics: SourceRelationshipDiagnostics,
  kind: ModuleResolutionKind,
): void {
  if (kind === "relative") diagnostics.relativeBindings += 1;
  else if (kind === "path_alias") diagnostics.pathAliasBindings += 1;
  else diagnostics.baseUrlBindings += 1;
}

function incrementResolvedModuleCount(
  diagnostics: SourceRelationshipDiagnostics,
  kind: ModuleResolutionKind,
): void {
  if (kind === "relative") diagnostics.resolvedRelativeBindings += 1;
  else if (kind === "path_alias") diagnostics.resolvedPathAliasBindings += 1;
  else diagnostics.resolvedBaseUrlBindings += 1;
}

function emptyDiagnostics(): SourceRelationshipDiagnostics {
  return {
    parsedBindings: 0,
    externalBindings: 0,
    relativeBindings: 0,
    pathAliasBindings: 0,
    baseUrlBindings: 0,
    resolvedRelativeBindings: 0,
    resolvedPathAliasBindings: 0,
    resolvedBaseUrlBindings: 0,
    resolvedRelationships: 0,
    unresolvedLocalBindings: 0,
    ambiguousLocalBindings: 0,
    exactSymbolRelationships: 0,
    exactModuleRelationships: 0,
    symbolBearingRelationships: 0,
    importsRelationships: 0,
    reexportsRelationships: 0,
    configurationFiles: 0,
    configurationFailures: 0,
  };
}

function compareRelationships(
  left: SourceRelationship,
  right: SourceRelationship,
): number {
  return (
    left.repositoryId.localeCompare(right.repositoryId) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.targetPath.localeCompare(right.targetPath) ||
    left.relationshipType.localeCompare(right.relationshipType) ||
    (left.targetSymbol ?? "").localeCompare(right.targetSymbol ?? "") ||
    left.id.localeCompare(right.id)
  );
}
