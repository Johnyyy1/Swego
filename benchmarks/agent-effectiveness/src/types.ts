export const CONDITIONS = ["A", "B"] as const;
export type BenchmarkCondition = (typeof CONDITIONS)[number];

export const TASK_SETS = ["final", "pilot"] as const;
export type TaskSet = (typeof TASK_SETS)[number];

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type TaskDifficulty = (typeof DIFFICULTIES)[number];

export interface PublicTaskDefinition {
  id: string;
  set: TaskSet;
  category: string;
  difficulty: TaskDifficulty;
  promptFile: string;
  promptSha256: string;
}

export interface VerificationCommand {
  label: string;
  command: string[];
  cwd: string;
  timeoutMs: number;
  required: boolean;
}

export interface PrivateTaskDefinition {
  taskId: string;
  rationale: string;
  requiredBehavioralOutcome: string[];
  relevantImplementationFiles: string[];
  supportingFiles: string[];
  verifierFiles: Array<{ source: string; destination: string }>;
  referencePatch: string;
  verificationCommands: VerificationCommand[];
}

export interface RunOrderEntry {
  runOrder: number;
  taskId: string;
  condition: BenchmarkCondition;
  pairPosition: 1 | 2;
}

export interface SolverConfiguration {
  codexBinary: string;
  codexVersion: string;
  model: string;
  effort: string;
  sandbox: "workspace-write";
  approvalPolicy: "never";
  userConfigIgnored: true;
  ephemeral: true;
  networkPolicy: {
    browserAndWebSearchTools: "disabled";
    solverShellExternalNetwork: "empirically-blocked-not-os-firewalled";
    localStdioMcp: "condition-b-only";
  };
  disabledFeatures: string[];
  wallClockTimeoutMs: number;
  terminationGraceMs: number;
  tokenCeiling: null;
  retryPolicy: {
    maximumRetries: 1;
    verifiedInfrastructureFailuresOnly: true;
  };
}

export interface FrozenSourceConfiguration {
  repository: "formbricks/formbricks";
  repositoryId: string;
  sourceRevision: string;
  sourceArchiveSha256: string;
  isolatedBaseCommit: string;
  isolatedBaseTree: string;
  trackedFileCount: number;
  packageManager: string;
  installCommand: string[];
}

export interface FrozenSwegaConfiguration {
  runtimeCommit: string;
  freezeDocumentationCommit: string;
  chunks: number;
  compatibleEmbeddings: number;
  relationships: number;
  embeddingProvider: "ollama";
  embeddingModel: string;
  embeddingDimensions: number;
  postgresVersion: string;
  pgvectorVersion: string;
  contextBudgetCharacters: number;
  reranker: "disabled";
  mcpTransport: "local-stdio";
  mcpTools: string[];
}

export interface ArtifactHash {
  path: string;
  sha256: string;
}

export interface BenchmarkFreezeManifest {
  schemaVersion: 1;
  benchmarkVersion: string;
  frozenAt: string;
  researchQuestion: string;
  solver: SolverConfiguration;
  source: FrozenSourceConfiguration;
  swega: FrozenSwegaConfiguration;
  randomization: {
    algorithm: "sha256-sort-and-pair-parity-v1";
    seed: string;
    finalRunOrder: RunOrderEntry[];
    pilotRunOrder: RunOrderEntry[];
  };
  finalTaskIds: string[];
  pilotTaskIds: string[];
  conditionConfigurationHashes: Record<BenchmarkCondition, string>;
  privateBundleSha256: string;
  privateArtifactHashes: ArtifactHash[];
  publicArtifactHashes: ArtifactHash[];
}

export interface TimestampedCodexEvent {
  receivedAt: string;
  elapsedMs: number;
  event: unknown;
}

export interface CommandRecord {
  command: string;
  startedElapsedMs: number | null;
  completedElapsedMs: number | null;
  exitCode: number | null;
  output: string;
}

export interface ParsedMcpCall {
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
  status: string;
  startedElapsedMs: number | null;
  completedElapsedMs: number | null;
}

export interface ToolMetrics {
  fileReadOperations: number;
  distinctFilesRead: string[];
  searchOperations: number;
  shellDiscoveryOperations: number;
  commandExecutions: number;
  fileChangeEvents: number;
  timeToFirstFileReadMs: number | null;
  timeToFirstEditMs: number | null;
  fileReadEvents: Array<{ path: string; elapsedMs: number | null }>;
}

export interface RelevantFileMetrics {
  relevantFiles: string[];
  relevantFilesVisited: string[];
  irrelevantFilesVisited: string[];
  relevantFilesEdited: string[];
  relevantFileRecall: number | null;
  timeToFirstRelevantFileMs: number | null;
}

export interface UsageMetrics {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
}

export interface SwegaCallMetric {
  tool: string;
  query: string | null;
  durationMs: number | null;
  evidenceItemCount: number | null;
  contextCharacters: number | null;
  surfacedFiles: string[];
  relevantFilesSurfaced: string[];
  surfacedFilesLaterOpened: string[];
  surfacedFilesEdited: string[];
  succeeded: boolean;
}

export interface SwegaMetrics {
  available: boolean;
  used: boolean;
  mcpCallCount: number;
  toolsCalled: string[];
  getContextCount: number;
  calls: SwegaCallMetric[];
}

export interface TestResult {
  label: string;
  command: string[];
  cwd: string;
  required: boolean;
  passed: boolean;
  exitCode: number | null;
  durationMs: number;
  stdoutArtifact: string;
  stderrArtifact: string;
}

export interface PatchStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export type CompletionStatus =
  "completed" | "timed_out" | "codex_error" | "infrastructure_failure";

export interface RunResult {
  schemaVersion: 1;
  benchmarkVersion: string;
  taskId: string;
  taskSet: TaskSet;
  condition: BenchmarkCondition;
  runOrder: number;
  model: string;
  effort: string;
  codexVersion: string;
  sourceRevision: string;
  startedAt: string;
  durationMs: number;
  completionStatus: CompletionStatus;
  verifierPassed: boolean;
  testResults: TestResult[];
  filesModified: string[];
  patchStats: PatchStats;
  toolMetrics: ToolMetrics;
  relevantFileMetrics: RelevantFileMetrics;
  usageMetrics: UsageMetrics;
  swegaMetrics: SwegaMetrics;
  infrastructureFailure: null | {
    verified: boolean;
    kind: string;
    detail: string;
  };
  retryNumber: number;
  transcriptArtifact: string;
  patchArtifact: string;
  stderrArtifact: string;
  finalMessageArtifact: string;
  unavailableMetrics: string[];
}

export interface PairedOutcome {
  taskId: string;
  A: boolean;
  B: boolean;
  outcome:
    "A-pass/B-pass" | "A-pass/B-fail" | "A-fail/B-pass" | "A-fail/B-fail";
  wallTimeDifferenceMs: number;
}

export interface BenchmarkAnalysis {
  benchmarkVersion: string;
  taskCount: number;
  conditionSuccess: { A: number; B: number };
  absoluteSuccessDifference: number;
  pairedOutcomeCounts: Record<PairedOutcome["outcome"], number>;
  discordantPairs: { AOnly: number; BOnly: number };
  exactMcNemarTwoSidedP: number;
  medianPairedWallTimeDifferenceMs: number | null;
  medianPairedFileReadDifference: number | null;
  medianPairedSearchDifference: number | null;
  medianPairedRelevantFileRecallDifference: number | null;
  medianPairedIrrelevantFileVisitDifference: number | null;
  medianPairedTotalTokenDifference: number | null;
  swega: {
    availableRuns: number;
    usedRuns: number;
    unusedRuns: number;
    getContextCalls: number;
  };
  categories: Array<{ category: string; A: number; B: number; tasks: number }>;
  pairs: PairedOutcome[];
  caution: string;
}
