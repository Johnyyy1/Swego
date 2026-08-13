import { describe, expect, test } from "bun:test";
import {
  buildCodexArguments,
  conditionConfiguration,
  RANDOMIZATION_SEED,
  SOLVER_CONFIGURATION,
} from "../src/config.ts";
import { generatePairedRunOrder } from "../src/order.ts";
import { buildSolverEnvironment } from "../src/codex.ts";

describe("paired order and condition configuration", () => {
  test("generates a deterministic, complete paired order", () => {
    const taskIds = ["t1", "t2", "t3"];
    const first = generatePairedRunOrder(taskIds, RANDOMIZATION_SEED);
    expect(first).toEqual(generatePairedRunOrder(taskIds, RANDOMIZATION_SEED));
    expect(first).toHaveLength(6);
    for (const taskId of taskIds) {
      const pair = first.filter((entry) => entry.taskId === taskId);
      expect(pair.map((entry) => entry.condition).sort()).toEqual(["A", "B"]);
      expect(pair.map((entry) => entry.pairPosition).sort()).toEqual([1, 2]);
    }
  });

  test("condition B only adds the SWEGA MCP registration", () => {
    const A = buildCodexArguments("A", "/tmp/workspace");
    const B = buildCodexArguments("B", "/tmp/workspace");
    expect(A.some((argument) => argument.includes("mcp_servers"))).toBe(false);
    expect(
      B.filter((argument) => argument.includes("mcp_servers.swega")),
    ).toHaveLength(4);
    expect(conditionConfiguration("A").ordinaryTools).toEqual(
      conditionConfiguration("B").ordinaryTools,
    );
    expect(conditionConfiguration("A").solver).toEqual(
      conditionConfiguration("B").solver,
    );
    expect(SOLVER_CONFIGURATION.model).toBe("gpt-5.6-sol");
    expect(SOLVER_CONFIGURATION.effort).toBe("xhigh");
  });

  test("solver environment uses an explicit non-secret allowlist", () => {
    const environment = buildSolverEnvironment({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DATABASE_URL: "postgresql://secret",
      GITHUB_TOKEN: "secret",
      SWEGA_P17_GRADER_KEY: "secret",
    });
    expect(environment.PATH).toBe("/usr/bin");
    expect(environment.HOME).toBe("/tmp/home");
    expect(environment.DATABASE_URL).toBeUndefined();
    expect(environment.GITHUB_TOKEN).toBeUndefined();
    expect(environment.SWEGA_P17_GRADER_KEY).toBeUndefined();
    expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
