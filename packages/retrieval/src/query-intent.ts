export const queryIntents = [
  "implementation",
  "tests",
  "configuration",
  "documentation",
  "database_schema",
  "migration",
  "api_endpoint",
  "exact_symbol",
  "error_handling",
  "authentication",
  "authorization",
  "history_rationale",
  "general",
] as const;

export type QueryIntent = (typeof queryIntents)[number];

export interface QueryIntentSignal {
  intent: QueryIntent;
  confidence: number;
  evidence: readonly string[];
}

interface IntentRule {
  intent: Exclude<QueryIntent, "general" | "exact_symbol">;
  confidence: number;
  evidence: string;
  pattern: RegExp;
}

const rules: readonly IntentRule[] = [
  {
    intent: "tests",
    confidence: 1,
    evidence: "explicit test terminology",
    pattern: /\b(?:test|tests|tested|testing|spec|specs)\b/iu,
  },
  {
    intent: "configuration",
    confidence: 0.95,
    evidence: "explicit configuration terminology",
    pattern:
      /\b(?:config|configuration|configure|configured|configuring|environment|settings?)\b/iu,
  },
  {
    intent: "database_schema",
    confidence: 0.95,
    evidence: "explicit database or schema terminology",
    pattern:
      /\b(?:database|schema|model(?:ed|led|s)?|prisma|table|column|relation(?:ship)?s?)\b/iu,
  },
  {
    intent: "database_schema",
    confidence: 0.85,
    evidence: "storage-location phrase",
    pattern: /\b(?:stored|persisted)\b.{0,40}\b(?:database|db)\b/iu,
  },
  {
    intent: "migration",
    confidence: 1,
    evidence: "explicit migration terminology",
    pattern: /\b(?:migration|migrations|migrate|migrated)\b/iu,
  },
  {
    intent: "api_endpoint",
    confidence: 0.9,
    evidence: "API or endpoint terminology",
    pattern:
      /\b(?:api|endpoint|route|router|request handler|webhook|graphql|rpc|rest)\b|\b(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/u,
  },
  {
    intent: "error_handling",
    confidence: 0.9,
    evidence: "error-handling terminology",
    pattern:
      /\b(?:error|errors|exception|exceptions|failure|failures|fallback|retry|retries|handled|handling|mapped|mapping)\b/iu,
  },
  {
    intent: "documentation",
    confidence: 0.95,
    evidence: "documentation terminology",
    pattern:
      /\b(?:documentation|docs|readme|guide|reference documentation|explain(?:ed|s|ing)?)\b/iu,
  },
  {
    intent: "authentication",
    confidence: 0.9,
    evidence: "authentication terminology",
    pattern:
      /\b(?:authentication|authenticate|authenticated|login|log in|sign in|session|sessions|credential|credentials)\b/iu,
  },
  {
    intent: "authorization",
    confidence: 0.9,
    evidence: "authorization terminology",
    pattern:
      /\b(?:authorization|authorize|authorized|permission|permissions|access control|role-based|rbac)\b/iu,
  },
  {
    intent: "history_rationale",
    confidence: 0.95,
    evidence: "history or rationale phrase",
    pattern:
      /\b(?:why|rationale|history|historical|introduced|changed|removed|deprecated|commit|pull request|pr)\b/iu,
  },
  {
    intent: "implementation",
    confidence: 1,
    evidence: "explicit implementation terminology",
    pattern:
      /\b(?:implement|implements|implemented|implementation|runtime|handler|functionality)\b/iu,
  },
  {
    intent: "implementation",
    confidence: 0.65,
    evidence: "engineering flow phrase",
    pattern: /\b(?:how does|how is|trace|flow|from .{0,40} through)\b/iu,
  },
  {
    intent: "implementation",
    confidence: 0.5,
    evidence: "code-location phrase",
    pattern: /\bwhere (?:is|are|does|do)\b/iu,
  },
] as const;

const intentOrder = new Map(
  queryIntents.map((intent, index) => [intent, index]),
);

export function analyzeQueryIntent(
  query: string,
): readonly QueryIntentSignal[] {
  const normalized = query.trim();
  const signals = new Map<
    QueryIntent,
    { confidence: number; evidence: string[] }
  >();

  const navigationEvidence = exactNavigationEvidence(normalized);
  if (navigationEvidence) {
    addSignal(signals, "exact_symbol", 1, navigationEvidence);
  }
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) {
      addSignal(signals, rule.intent, rule.confidence, rule.evidence);
    }
  }
  if (signals.size === 0) {
    addSignal(
      signals,
      "general",
      0.25,
      "no specific engineering intent signal",
    );
  }

  return [...signals.entries()]
    .map(([intent, signal]) => ({ intent, ...signal }))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        (intentOrder.get(left.intent) ?? 0) -
          (intentOrder.get(right.intent) ?? 0),
    );
}

function exactNavigationEvidence(query: string): string | null {
  if (/^[^\s/\\]+\.[a-z][a-z0-9]{0,9}$/iu.test(query)) {
    return "filename-shaped query";
  }
  if (/^(?:\.?\.?[/\\])?[^\s]+[/\\][^\s]+$/u.test(query)) {
    return "path-shaped query";
  }
  if (
    /^(?:[$A-Z_a-z][$\w]*)(?:(?:\.|::|#)[$A-Z_a-z][$\w]*)*$/u.test(query) &&
    (/^[A-Z]/u.test(query) ||
      /[A-Z]/u.test(query.slice(1)) ||
      /[_$.:#]/u.test(query))
  ) {
    return "identifier-shaped query";
  }
  return null;
}

function addSignal(
  signals: Map<QueryIntent, { confidence: number; evidence: string[] }>,
  intent: QueryIntent,
  confidence: number,
  evidence: string,
): void {
  const current = signals.get(intent) ?? { confidence: 0, evidence: [] };
  current.confidence = Math.max(current.confidence, confidence);
  if (!current.evidence.includes(evidence)) current.evidence.push(evidence);
  signals.set(intent, current);
}
