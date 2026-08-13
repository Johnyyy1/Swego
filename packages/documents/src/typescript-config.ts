import { posix } from "node:path";

import ts from "typescript";

import type { RelationshipSourceFile } from "./relationships";

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

export type ModuleResolutionKind = "relative" | "path_alias" | "base_url";

export interface ResolvedModule {
  status: "resolved";
  path: string;
  kind: ModuleResolutionKind;
  configurationPath: string | null;
  configurationCommitSha: string | null;
  configurationFiles: readonly RelationshipSourceFile[];
}

export type ModuleResolution =
  | ResolvedModule
  | {
      status: "unresolved";
      kind: ModuleResolutionKind;
    }
  | {
      status: "ambiguous";
      kind: ModuleResolutionKind;
    }
  | { status: "external" };

interface PathMapping {
  pattern: string;
  prefix: string;
  suffix: string;
  targets: readonly string[];
  configurationPath: string;
}

interface BaseUrl {
  root: string;
  configurationPath: string;
}

interface ParsedProjectConfig {
  path: string;
  files: readonly RelationshipSourceFile[];
  baseUrl: BaseUrl | null;
  paths: readonly PathMapping[];
}

/** Resolves only static, repository-local TypeScript/JavaScript modules. */
export class TypeScriptProjectResolver {
  private readonly configCache = new Map<string, ParsedProjectConfig | null>();
  private readonly configPaths: ReadonlySet<string>;
  private configFailures = 0;

  constructor(
    private readonly files: ReadonlyMap<string, RelationshipSourceFile>,
  ) {
    this.configPaths = new Set(
      [...files.keys()].filter((path) => isProjectConfigPath(path)),
    );
  }

  resolve(sourcePath: string, specifier: string): ModuleResolution {
    if (!safeRepositoryPath(sourcePath)) {
      return specifier.startsWith(".")
        ? { status: "unresolved", kind: "relative" }
        : { status: "external" };
    }
    if (specifier.startsWith(".")) {
      const path = resolveFilePath(
        safeRepositoryPath(
          posix.normalize(posix.join(posix.dirname(sourcePath), specifier)),
        ),
        this.files,
      );
      return path
        ? {
            status: "resolved",
            path,
            kind: "relative",
            configurationPath: null,
            configurationCommitSha: null,
            configurationFiles: [],
          }
        : { status: "unresolved", kind: "relative" };
    }
    if (!isBareSpecifier(specifier)) return { status: "external" };
    const config = this.closestConfig(sourcePath);
    if (!config) return { status: "external" };

    const matching = config.paths
      .map((mapping) => ({ mapping, wildcard: matchPath(mapping, specifier) }))
      .filter(
        (candidate): candidate is { mapping: PathMapping; wildcard: string } =>
          candidate.wildcard !== null,
      )
      .sort(
        (left, right) =>
          pathMappingSpecificity(right.mapping) -
          pathMappingSpecificity(left.mapping),
      );
    const selected = matching[0];
    if (selected) {
      const resolved = new Set<string>();
      for (const target of selected.mapping.targets) {
        const substituted = target.replace("*", selected.wildcard);
        const path = resolveFilePath(substituted, this.files);
        if (path) resolved.add(path);
      }
      if (resolved.size > 1) {
        return { status: "ambiguous", kind: "path_alias" };
      }
      const path = [...resolved][0];
      if (!path) return { status: "unresolved", kind: "path_alias" };
      const configuration = this.files.get(selected.mapping.configurationPath);
      return {
        status: "resolved",
        path,
        kind: "path_alias",
        configurationPath: selected.mapping.configurationPath,
        configurationCommitSha:
          configuration?.document.document.commitSha ?? null,
        configurationFiles: config.files,
      };
    }

    if (config.baseUrl) {
      const path = resolveFilePath(
        safeRepositoryPath(posix.join(config.baseUrl.root, specifier)),
        this.files,
      );
      // A bare name that misses baseUrl may still be an external package. Keep
      // it outside local-resolution diagnostics rather than claiming a local
      // unresolved binding.
      if (!path) return { status: "external" };
      const configuration = this.files.get(config.baseUrl.configurationPath);
      return {
        status: "resolved",
        path,
        kind: "base_url",
        configurationPath: config.baseUrl.configurationPath,
        configurationCommitSha:
          configuration?.document.document.commitSha ?? null,
        configurationFiles: config.files,
      };
    }
    return { status: "external" };
  }

  diagnostics(): { configurationFiles: number; configurationFailures: number } {
    return {
      configurationFiles: this.configCache.size,
      configurationFailures: this.configFailures,
    };
  }

  private closestConfig(sourcePath: string): ParsedProjectConfig | null {
    let directory = posix.dirname(sourcePath);
    while (true) {
      const prefix = directory === "." ? "" : `${directory}/`;
      for (const name of ["tsconfig.json", "jsconfig.json"] as const) {
        const path = `${prefix}${name}`;
        if (this.configPaths.has(path))
          return this.parseConfig(path, new Set());
      }
      if (directory === ".") return null;
      directory = posix.dirname(directory);
    }
  }

  private parseConfig(
    path: string,
    visiting: ReadonlySet<string>,
  ): ParsedProjectConfig | null {
    const cached = this.configCache.get(path);
    if (cached !== undefined) return cached;
    if (visiting.has(path)) {
      this.configFailures += 1;
      return null;
    }
    const source = this.files.get(path);
    if (!source) return null;
    const result = ts.parseConfigFileTextToJson(path, source.content);
    if (result.error || !isRecord(result.config)) {
      this.configFailures += 1;
      this.configCache.set(path, null);
      return null;
    }

    const nextVisiting = new Set(visiting).add(path);
    let parent: ParsedProjectConfig | null = null;
    const extendsValue = result.config.extends;
    if (typeof extendsValue === "string" && extendsValue.startsWith(".")) {
      const parentPath = resolveExtendedConfigPath(path, extendsValue);
      if (parentPath && this.files.has(parentPath)) {
        parent = this.parseConfig(parentPath, nextVisiting);
      } else {
        this.configFailures += 1;
      }
    }

    const compilerOptions = isRecord(result.config.compilerOptions)
      ? result.config.compilerOptions
      : {};
    const configDirectory = posix.dirname(path);
    const rawBaseUrl =
      typeof compilerOptions.baseUrl === "string"
        ? compilerOptions.baseUrl
        : null;
    if (rawBaseUrl && isAbsoluteConfigPath(rawBaseUrl)) {
      this.configFailures += 1;
    }
    const ownBaseUrl =
      rawBaseUrl && !isAbsoluteConfigPath(rawBaseUrl)
        ? safeRepositoryPath(posix.join(configDirectory, rawBaseUrl))
        : null;
    const baseUrl: BaseUrl | null = ownBaseUrl
      ? { root: ownBaseUrl, configurationPath: path }
      : (parent?.baseUrl ?? null);
    const ownPaths = parsePaths(
      compilerOptions.paths,
      baseUrl?.root ?? configDirectory,
      path,
      () => {
        this.configFailures += 1;
      },
    );
    const parsed: ParsedProjectConfig = {
      path,
      files: [...(parent?.files ?? []), source],
      baseUrl,
      paths: ownPaths ?? parent?.paths ?? [],
    };
    this.configCache.set(path, parsed);
    return parsed;
  }
}

function parsePaths(
  value: unknown,
  root: string,
  configurationPath: string,
  recordFailure: () => void,
): readonly PathMapping[] | null {
  if (!isRecord(value)) return null;
  return Object.entries(value).flatMap(([pattern, rawTargets]) => {
    if (countOccurrences(pattern, "*") > 1 || !Array.isArray(rawTargets)) {
      return [];
    }
    const targets = rawTargets.flatMap((target) => {
      if (typeof target !== "string" || countOccurrences(target, "*") > 1) {
        return [];
      }
      if (isAbsoluteConfigPath(target)) {
        recordFailure();
        return [];
      }
      const resolved = safeRepositoryPath(posix.join(root, target));
      return resolved ? [resolved] : [];
    });
    if (targets.length === 0) return [];
    const star = pattern.indexOf("*");
    return [
      {
        pattern,
        prefix: star === -1 ? pattern : pattern.slice(0, star),
        suffix: star === -1 ? "" : pattern.slice(star + 1),
        targets,
        configurationPath,
      },
    ];
  });
}

function matchPath(mapping: PathMapping, specifier: string): string | null {
  if (!mapping.pattern.includes("*")) {
    return mapping.pattern === specifier ? "" : null;
  }
  if (
    !specifier.startsWith(mapping.prefix) ||
    !specifier.endsWith(mapping.suffix) ||
    specifier.length < mapping.prefix.length + mapping.suffix.length
  ) {
    return null;
  }
  return specifier.slice(
    mapping.prefix.length,
    specifier.length - mapping.suffix.length,
  );
}

function pathMappingSpecificity(mapping: PathMapping): number {
  return mapping.pattern.includes("*")
    ? mapping.prefix.length
    : Number.MAX_SAFE_INTEGER;
}

function resolveExtendedConfigPath(
  sourceConfigPath: string,
  specifier: string,
): string | null {
  const base = safeRepositoryPath(
    posix.join(posix.dirname(sourceConfigPath), specifier),
  );
  if (!base) return null;
  return posix.extname(base) ? base : `${base}.json`;
}

function resolveFilePath(
  base: string | null,
  files: ReadonlyMap<string, RelationshipSourceFile>,
): string | null {
  if (!base) return null;
  const candidates = [base];
  const extension = posix.extname(base);
  if (!extension) {
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      candidates.push(`${base}${sourceExtension}`);
      candidates.push(`${base}/index${sourceExtension}`);
    }
  } else if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const stem = base.slice(0, -extension.length);
    for (const sourceExtension of [".ts", ".tsx", ".mts", ".cts"] as const) {
      candidates.push(`${stem}${sourceExtension}`);
    }
  }
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

function safeRepositoryPath(value: string): string | null {
  const normalized = posix.normalize(value).replace(/^\.\//u, "");
  return normalized !== ".." &&
    !normalized.startsWith("../") &&
    !normalized.startsWith("/")
    ? normalized
    : null;
}

function isAbsoluteConfigPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/])/u.test(value);
}

function isBareSpecifier(specifier: string): boolean {
  return (
    specifier.length > 0 &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("#")
  );
}

function isProjectConfigPath(path: string): boolean {
  return /(^|\/)(tsconfig|jsconfig)\.json$/u.test(path);
}

function countOccurrences(value: string, character: string): number {
  return [...value].filter((current) => current === character).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
