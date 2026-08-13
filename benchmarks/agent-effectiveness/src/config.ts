import { sha256, stableJson } from "./hash.ts";
import { SWEGA_ROOT } from "./paths.ts";
import type { BenchmarkCondition, SolverConfiguration } from "./types.ts";

export const BENCHMARK_VERSION = "swega-agent-effectiveness-v1";
export const RANDOMIZATION_SEED = "swega-p17a-20260813";
export const SOURCE_REVISION = "88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5";
export const REPOSITORY_ID = "a61b0198-8307-41b0-9b51-9c510793cefa";
export const CODEX_BINARY =
  "/Applications/ChatGPT.app/Contents/Resources/codex";
export const CODEX_VERSION = "codex-cli 0.147.0-alpha.6.6";

export const DISABLED_CODEX_FEATURES = [
  "apps",
  "plugins",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "in_app_browser",
  "computer_use",
  "enable_mcp_apps",
  "multi_agent",
  "multi_agent_v2",
  "network_proxy",
  "plugin_sharing",
  "skill_search",
  "skill_env_var_dependency_prompt",
  "image_generation",
  "recommended_plugins",
  "remote_plugin",
  "standalone_web_search",
] as const;

export const SOLVER_CONFIGURATION: SolverConfiguration = {
  codexBinary: CODEX_BINARY,
  codexVersion: CODEX_VERSION,
  model: "gpt-5.6-sol",
  effort: "xhigh",
  sandbox: "workspace-write",
  approvalPolicy: "never",
  userConfigIgnored: true,
  ephemeral: true,
  networkPolicy: {
    browserAndWebSearchTools: "disabled",
    solverShellExternalNetwork: "empirically-blocked-not-os-firewalled",
    localStdioMcp: "condition-b-only",
  },
  disabledFeatures: [...DISABLED_CODEX_FEATURES],
  wallClockTimeoutMs: 1_800_000,
  terminationGraceMs: 10_000,
  tokenCeiling: null,
  retryPolicy: { maximumRetries: 1, verifiedInfrastructureFailuresOnly: true },
};

const commonCodexArguments = (workspace: string): string[] => [
  "exec",
  "--ephemeral",
  "--ignore-user-config",
  "--strict-config",
  "--model",
  SOLVER_CONFIGURATION.model,
  "-c",
  `model_reasoning_effort="${SOLVER_CONFIGURATION.effort}"`,
  "-c",
  `approval_policy="${SOLVER_CONFIGURATION.approvalPolicy}"`,
  "-c",
  'web_search="disabled"',
  ...DISABLED_CODEX_FEATURES.flatMap((feature) => [
    "-c",
    `features.${feature}=false`,
  ]),
  "--sandbox",
  SOLVER_CONFIGURATION.sandbox,
  "--json",
  "--cd",
  workspace,
];

export const treatmentMcpOverrides = (): string[] => [
  "-c",
  'mcp_servers.swega.command="/Users/jonas/.bun/bin/bun"',
  "-c",
  'mcp_servers.swega.args=["run","swega:mcp"]',
  "-c",
  `mcp_servers.swega.cwd=${JSON.stringify(SWEGA_ROOT)}`,
  "-c",
  'mcp_servers.swega.env={DATABASE_URL="postgresql://swega:swega@127.0.0.1:5433/swega_benchmark",EMBEDDING_PROVIDER="ollama",OLLAMA_URL="http://127.0.0.1:11434",OLLAMA_EMBEDDING_MODEL="qwen3-embedding:0.6b",EMBEDDING_DIMENSIONS="512",RERANKER_PROVIDER=""}',
];

export const buildCodexArguments = (
  condition: BenchmarkCondition,
  workspace: string,
): string[] => [
  ...commonCodexArguments(workspace),
  ...(condition === "B" ? treatmentMcpOverrides() : []),
  "-",
];

export const conditionConfiguration = (
  condition: BenchmarkCondition,
): Record<string, unknown> => ({
  condition,
  ordinaryTools: [
    "repository reads",
    "repository search",
    "file editing",
    "shell",
    "tests",
    "git",
  ],
  solver: SOLVER_CONFIGURATION,
  swegaMcp:
    condition === "B"
      ? { enabled: true, overrides: treatmentMcpOverrides() }
      : { enabled: false },
  additionalEnvironmentInstruction: null,
});

export const conditionConfigurationHash = (
  condition: BenchmarkCondition,
): string => sha256(stableJson(conditionConfiguration(condition)));
