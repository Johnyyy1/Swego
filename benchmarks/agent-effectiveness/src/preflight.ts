import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildCodexArguments,
  CODEX_BINARY,
  CODEX_VERSION,
  REPOSITORY_ID,
  SOLVER_CONFIGURATION,
  SOURCE_REVISION,
  treatmentMcpOverrides,
} from "./config.ts";
import { BASE_WORKSPACE, SWEGA_ROOT } from "./paths.ts";
import { runProcess } from "./process.ts";
import {
  prepareBaseWorkspace,
  sourceArchiveHash,
  verifyBaseWorkspace,
} from "./workspace.ts";
import { loadFreezeManifest, loadPublicTasks } from "./schema.ts";
import {
  closePrivateArtifacts,
  loadPrivateTask,
  openPrivateArtifacts,
  validatePrivateArtifacts,
} from "./verifier.ts";

export interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

const check = (
  name: string,
  passed: boolean,
  detail: string,
): PreflightCheck => ({ name, passed, detail });

const requireSuccess = (
  name: string,
  result: Awaited<ReturnType<typeof runProcess>>,
): string => {
  if (result.exitCode !== 0)
    throw new Error(`${name}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
};

const databaseCheck = async (): Promise<PreflightCheck> => {
  const sql = [
    "select r.id,",
    "(select rf.last_known_commit_sha from repository_files rf where rf.repository_id=r.id and rf.last_known_commit_sha is not null limit 1),",
    "(select count(*) from document_chunks dc where dc.repository_id=r.id),",
    "(select count(*) from chunk_embeddings ce where ce.repository_id=r.id and ce.provider='ollama' and ce.model='qwen3-embedding:0.6b' and ce.dimensions=512),",
    "(select count(*) from source_relationships sr where sr.repository_id=r.id)",
    "from repositories r where r.id='a61b0198-8307-41b0-9b51-9c510793cefa';",
  ].join(" ");
  const result = await runProcess({
    command: [
      "docker",
      "exec",
      "swega-benchmark-postgres-1",
      "psql",
      "-U",
      "swega",
      "-d",
      "swega_benchmark",
      "-At",
      "-F",
      "|",
      "-c",
      sql,
    ],
    cwd: SWEGA_ROOT,
    timeoutMs: 30_000,
  });
  const output = requireSuccess("database preflight", result);
  const expected = `${REPOSITORY_ID}|${SOURCE_REVISION}|23430|23430|14815`;
  return check("database-and-memory", output === expected, output);
};

const ollamaCheck = async (): Promise<PreflightCheck> => {
  const response = await fetch("http://127.0.0.1:11434/api/tags", {
    signal: AbortSignal.timeout(5_000),
  });
  const payload = (await response.json()) as {
    models?: Array<{ name?: string }>;
  };
  const ready =
    response.ok &&
    payload.models?.some((model) => model.name === "qwen3-embedding:0.6b") ===
      true;
  return check(
    "ollama",
    ready,
    ready ? "qwen3-embedding:0.6b ready" : "embedding model missing",
  );
};

const mcpCheck = async (): Promise<PreflightCheck> => {
  const requireFromMcp = createRequire(
    path.join(SWEGA_ROOT, "apps", "mcp", "package.json"),
  );
  const clientEntry = requireFromMcp.resolve("@modelcontextprotocol/client");
  const stdioEntry = requireFromMcp.resolve(
    "@modelcontextprotocol/client/stdio.js",
  );
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientEntry).href) as Promise<{
      Client: new (identity: { name: string; version: string }) => {
        connect(transport: unknown): Promise<void>;
        listTools(): Promise<{ tools: Array<{ name: string }> }>;
        callTool(input: {
          name: string;
          arguments: Record<string, unknown>;
        }): Promise<unknown>;
        close(): Promise<void>;
      };
    }>,
    import(pathToFileURL(stdioEntry).href) as Promise<{
      StdioClientTransport: new (options: {
        command: string;
        args: string[];
        cwd: string;
        env: Record<string, string>;
        stderr: "pipe";
      }) => unknown;
    }>,
  ]);
  const client = new Client({ name: "p17-preflight", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "/Users/jonas/.bun/bin/bun",
    args: ["run", "swega:mcp"],
    cwd: SWEGA_ROOT,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      DATABASE_URL: "postgresql://swega:swega@127.0.0.1:5433/swega_benchmark",
      EMBEDDING_PROVIDER: "ollama",
      OLLAMA_URL: "http://127.0.0.1:11434",
      OLLAMA_EMBEDDING_MODEL: "qwen3-embedding:0.6b",
      EMBEDDING_DIMENSIONS: "512",
      RERANKER_PROVIDER: "",
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools
      .map((tool) => tool.name)
      .sort();
    const expected = [
      "swega_get_context",
      "swega_get_repository",
      "swega_list_repositories",
    ];
    const listed = await client.callTool({
      name: "swega_list_repositories",
      arguments: {},
    });
    const repositoryVisible = JSON.stringify(listed).includes(REPOSITORY_ID);
    return check(
      "swega-mcp",
      JSON.stringify(tools) === JSON.stringify(expected) && repositoryVisible,
      tools.join(","),
    );
  } finally {
    await client.close();
  }
};

const codexCheck = async (): Promise<PreflightCheck[]> => {
  const version = requireSuccess(
    "Codex version",
    await runProcess({
      command: [CODEX_BINARY, "--version"],
      cwd: SWEGA_ROOT,
      timeoutMs: 10_000,
    }),
  );
  const baselineArguments = buildCodexArguments("A", "/tmp/p17-workspace");
  const treatmentArguments = buildCodexArguments("B", "/tmp/p17-workspace");
  const temporaryHome = await mkdtemp(
    path.join(os.tmpdir(), "p17-codex-home-"),
  );
  try {
    const emptyMcp = await runProcess({
      command: [CODEX_BINARY, "mcp", "list", "--json"],
      cwd: SWEGA_ROOT,
      timeoutMs: 10_000,
      env: { ...process.env, CODEX_HOME: temporaryHome },
    });
    const baselineHasNoMcp =
      emptyMcp.exitCode === 0 && !emptyMcp.stdout.includes("swega");
    const treatmentGet = await runProcess({
      command: [
        CODEX_BINARY,
        "mcp",
        "get",
        ...treatmentMcpOverrides(),
        "swega",
        "--json",
      ],
      cwd: SWEGA_ROOT,
      timeoutMs: 10_000,
    });
    return [
      check("codex-version", version === CODEX_VERSION, version),
      check(
        "condition-a-no-swega",
        baselineHasNoMcp &&
          baselineArguments.every(
            (argument) => !argument.includes("mcp_servers"),
          ),
        "empty MCP stack plus --ignore-user-config",
      ),
      check(
        "condition-b-swega-only-difference",
        treatmentGet.exitCode === 0 &&
          treatmentGet.stdout.includes('"name": "swega"'),
        "explicit local stdio swega server",
      ),
      check(
        "solver-configuration",
        treatmentArguments.includes("gpt-5.6-sol") &&
          treatmentArguments.some((argument) =>
            argument.includes('model_reasoning_effort="xhigh"'),
          ) &&
          SOLVER_CONFIGURATION.sandbox === "workspace-write",
        `${SOLVER_CONFIGURATION.model}/${SOLVER_CONFIGURATION.effort}`,
      ),
    ];
  } finally {
    await rm(temporaryHome, { recursive: true });
  }
};

const privateIsolationCheck = async (): Promise<PreflightCheck> => {
  const privateDirectory = await openPrivateArtifacts(
    `preflight-${crypto.randomUUID()}`,
  );
  try {
    const tasks = await loadPublicTasks();
    await validatePrivateArtifacts(privateDirectory);
    for (const task of tasks) await loadPrivateTask(privateDirectory, task.id);
    const leaked = await runProcess({
      command: ["rg", "-l", "__p17_fb_|P17 hidden", "."],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    });
    return check(
      "hidden-grader-isolation",
      leaked.exitCode === 1,
      "encrypted bundle decrypts for grader; no hidden verifier marker exists in solver base",
    );
  } finally {
    await closePrivateArtifacts(privateDirectory);
  }
};

const sourceFreezeCheck = async (): Promise<PreflightCheck> => {
  const manifest = await loadFreezeManifest();
  const [archiveHash, head, tree, tracked] = await Promise.all([
    sourceArchiveHash(),
    runProcess({
      command: ["git", "rev-parse", "HEAD"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
    runProcess({
      command: ["git", "rev-parse", "HEAD^{tree}"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
    runProcess({
      command: ["git", "ls-files"],
      cwd: BASE_WORKSPACE,
      timeoutMs: 30_000,
    }),
  ]);
  const trackedCount = requireSuccess("base tracked files", tracked).split(
    "\n",
  ).length;
  const passed =
    archiveHash === manifest.source.sourceArchiveSha256 &&
    requireSuccess("base HEAD", head) === manifest.source.isolatedBaseCommit &&
    requireSuccess("base tree", tree) === manifest.source.isolatedBaseTree &&
    trackedCount === manifest.source.trackedFileCount;
  return check(
    "source-freeze",
    passed,
    `${archiveHash}; ${String(trackedCount)} tracked files`,
  );
};

export const runPreflight = async (
  options: { validateSourceManifest?: boolean } = {},
): Promise<PreflightCheck[]> => {
  await prepareBaseWorkspace();
  await verifyBaseWorkspace();
  const checks = [
    check(
      "isolated-base",
      true,
      "one commit, no remotes, clean worktree, dependencies installed",
    ),
    ...(options.validateSourceManifest === false
      ? []
      : [await sourceFreezeCheck()]),
    ...(await codexCheck()),
    await databaseCheck(),
    await ollamaCheck(),
    await mcpCheck(),
    await privateIsolationCheck(),
  ];
  const failed = checks.filter((entry) => !entry.passed);
  if (failed.length > 0)
    throw new Error(
      `Preflight failed: ${failed.map((entry) => entry.name).join(", ")}`,
    );
  return checks;
};
