# Optional local reranking

## Scope

Reranking is an explicit post-retrieval stage:

```text
query
  ├─ dense candidates
  ├─ lexical candidates
  └─ structured symbol/path candidates
          ↓
   Reciprocal Rank Fusion
          ↓
   path diversification
          ↓
  top 50 unique candidates
          ↓
   local cross-encoder
          ↓
      final top K
```

It does not replace candidate generation and cannot introduce a document that was absent from the fused candidate pool. Search without `--rerank` uses the Candidate Generation v2 ranking directly.

`@swega/reranking` defines a small provider-neutral `Reranker` contract over a query and candidate texts. `@swega/retrieval` owns conversion from `MemorySearchResult` to the minimal relevance text and attaches `rerankerScore`, `rerankerRank`, and `finalRank` while preserving dense, lexical, structured, RRF, and provenance diagnostics.

Candidates contain path, source type, line range, and chunk content. A source reference is included only when no path exists. Stable chunk IDs correlate scores locally but are not sent as document text. The wrapper de-duplicates chunk IDs and rejects missing, duplicate, unknown, or non-finite scores.

## Model and runtime

The initial local adapter uses [llama.cpp's reranking endpoint](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-reranking-rerank-documents-according-to-a-given-query) with [Qwen3-Reranker-0.6B](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B). This is a relevance model, not a general chat prompt. The official Qwen model card reports MTEB-Code reranking of 73.42 versus 41.38 for BGE-reranker-v2-m3, while the 0.6B size remains practical on developer hardware.

SWEGA was verified with the community Q4_K_M GGUF conversion `giladgd/Qwen3-Reranker-0.6B-GGUF` at repository revision `dfad7d6a83064e655eadb0c7f049d3f68a51d823`. Its model file is about 396 MB decimal (378 MiB) with SHA-256 `046ccc0b4cb9be503b3320bfaa4e6b809ca871db2d7eb1ab6f9fd3f84170aede`. The original and conversion are Apache-2.0 licensed. Quantization can change model quality, so the exact model and runtime belong in benchmark provenance.

Install llama.cpp separately, then explicitly start the server. This command downloads the model only when the developer runs it; SWEGA never downloads or starts it during search:

```bash
brew install llama.cpp

llama-server \
  --hf-repo giladgd/Qwen3-Reranker-0.6B-GGUF \
  --hf-file Qwen3-Reranker-0.6B.Q4_K_M.gguf \
  --reranking \
  --alias Qwen3-Reranker-0.6B.Q4_K_M \
  --host 127.0.0.1 \
  --port 8091 \
  --no-webui \
  --ctx-size 4096 \
  --batch-size 4096 \
  --ubatch-size 4096 \
  --parallel 1
```

The 4,096 logical and physical batches accommodated the largest candidates in the evaluated Formbricks snapshot. One slot avoids the large transient Metal allocations observed when llama.cpp automatically created four concurrent slots on a 16 GB machine.

## Configuration

Reranking is disabled when `RERANKER_PROVIDER` is unset:

```dotenv
RERANKER_PROVIDER=llama.cpp
LLAMA_CPP_RERANKER_URL=http://127.0.0.1:8091
LLAMA_CPP_RERANKER_MODEL=Qwen3-Reranker-0.6B.Q4_K_M
```

The llama.cpp adapter rejects non-loopback endpoints, URL credentials, and malformed responses. Before scoring, it verifies that `/v1/models` reports the configured alias; the explicit `--alias` prevents llama.cpp's single-model endpoint from silently ignoring a mismatched request model. Local mode therefore cannot send repository contents to a remote host. Provider errors include status and model context but never candidate source contents.

If `--rerank` is requested without configuration, SWEGA reports the required environment setting. If the configured server or endpoint is unavailable, the command fails explicitly; there is no silent hybrid fallback that could be mistaken for reranked output.

## CLI and doctor

```bash
# Existing hybrid behavior
bun run swega search <repository-id> "session implementation"

# Bounded hybrid plus local reranking
bun run swega search <repository-id> "session implementation" --rerank
bun run swega search <repository-id> "session implementation" --rerank --debug

# Reproducible comparison
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank
bun run swega benchmark benchmarks/formbricks-smoke.json --rerank --json
```

Reranked searches accept a final limit up to the configured candidate pool. The default is 50. Debug output preserves branch, RRF, reranker, and final ranks. `--candidate-limit N` and `--path-limit N` support controlled pool/diversification experiments.

When `RERANKER_PROVIDER` is configured, `swega doctor` sends two harmless health-check strings and reports reranker provider, model, endpoint, status, and a startup action on failure. With no configured reranker, doctor retains its embedding/database-only behavior.

## Formbricks smoke comparison

### Candidate Generation v2 (11 cases)

The pre-change 30-candidate baseline and selected 50-candidate v2 configuration used the same pinned snapshot, model, and runtime:

| Configuration | Candidate recall |   MRR | Recall@5 | Recall@10 | Hit Rate@10 | nDCG@10 |  Mean rerank |
| ------------- | ---------------: | ----: | -------: | --------: | ----------: | ------: | -----------: |
| legacy 30     |            0.667 | 0.697 |    0.636 |     0.667 |       0.818 |   0.610 | not captured |
| v2 50         |            0.833 | 0.652 |    0.697 |     0.788 |       0.909 |   0.629 |      25.16 s |

The broader session-flow case changed from no target in the candidate/final top 10 to both targets in the pool and final top 10 (first relevant rank 6). GitHub-auth configuration coverage improved from one of three targets at rank 6 to two of three at rank 4. Survey-endpoint validation remained rank 1 while nDCG rose from 0.676 to 0.731. The external-URL test moved from rank 1 to 2, and survey redirect behavior moved from rank 2 to 4. Unauthorized handling still has no final hit: `api-wrapper.ts` enters the pool at candidate rank 50 but is reranked below 10, while `authenticate-request.ts` remains absent. The session implementation, redirect database result, and three exact-symbol/component cases retained their prior first-relevant ranks.

Candidate recall is macro target coverage across the complete pre-rerank pool, not Recall@10. The legacy value was reproduced by wrapping the prior dense/lexical top-30 configuration with the diagnostic evaluator.

### Earlier reranking baseline (8 cases)

The eight reviewed cases at Formbricks commit `88a38c081fc7536a4edf74f8b03f9cf9ce4ee2d5` produced:

| Strategy      |   MRR | Recall@5 | Recall@10 | nDCG@10 |
| ------------- | ----: | -------: | --------: | ------: |
| hybrid        | 0.438 |    0.500 |     0.500 |   0.394 |
| hybrid+rerank | 0.531 |    0.500 |     0.500 |   0.450 |

Improved cases:

- `locate-redirect-database-model`: first relevant rank 2 → 1.
- `locate-survey-validation-endpoint`: first relevant rank 2 → 1 and nDCG@10 0.552 → 1.000.

Worse case:

- `understand-session-flow`: first relevant rank 2 → 4 and nDCG@10 0.387 → 0.264.

The session-implementation case stayed at rank 1, with `apps/web/modules/auth/lib/session.ts` scoring 0.972. Five cases had unchanged hits or misses. Recall did not improve because no new candidates enter after RRF. Eight cases are a smoke test, not statistically meaningful evidence for a default ranking change.

## Observed resources and latency

Measurements were taken on an arm64 Mac with 16 GB unified memory, llama.cpp build 9960, Qwen3 Q4_K_M, one 4,096-token slot, PostgreSQL and Ollama already running:

| Operation                                 | Wall time |
| ----------------------------------------- | --------: |
| Hybrid query, top 10                      |    1.00 s |
| Same query, rerank 30 → top 10            |   18.52 s |
| Eight-case benchmark with four strategies |  190.48 s |

These are single smoke measurements, not a latency benchmark. The cached model used 378 MiB on disk and the idle server showed approximately 855 MiB resident memory after evaluation. At least 2 GiB of available memory is recommended for the one-slot profile. Four automatic slots exhausted Metal memory on the measured 16 GB system under its existing workload.

Candidate Generation v2 pool experiments on the 11-case fixture used the same one-slot server. Candidate bytes are the UTF-8 bytes formatted for reranking; they are a deterministic pool-memory proxy, not process RSS:

| Pool | Candidate recall | Final Recall@10 |   MRR | nDCG@10 | Mean bytes | Mean rerank | Wall time |
| ---: | ---------------: | --------------: | ----: | ------: | ---------: | ----------: | --------: |
|   30 |            0.788 |           0.788 | 0.659 |   0.634 |     74 KiB |     17.77 s |  209.49 s |
|   50 |            0.833 |           0.788 | 0.652 |   0.629 |    115 KiB |     25.16 s |  290.51 s |
|   75 |            0.833 |           0.788 | 0.647 |   0.626 |    167 KiB |     55.61 s |  629.36 s |
|  100 |            0.833 |           0.788 | 0.644 |   0.623 |    216 KiB |     62.80 s |  705.17 s |

Pool 50 is the default because it is the smallest measured pool above 0.80 candidate recall. Pools 75 and 100 added no relevant target and worsened quality/latency. Pool 30 is the lower-latency alternative and had slightly better final ordering, but it missed the primary candidate-recall target.

Per-path caps of two and three produced identical candidate coverage and final smoke rankings at the selected pool size. Two is therefore the default: it retains multiple symbols from a file with less redundant representation. Exact-symbol preservation reserves one of those slots rather than exceeding the cap.

## Known failure modes

- Relevant material outside the configured candidate pool cannot be recovered.
- A general relevance model can prefer tests or prose over the exact implementation and can make individual queries worse.
- Full code chunks make CPU/Metal inference slow; smaller context or a smaller model trades quality for latency and must be evaluated.
- llama.cpp returns an explicit error when a prompt exceeds its physical batch; use the documented matching `--batch-size` and `--ubatch-size` values.
- A server started with too many parallel slots can exhaust unified/GPU memory.
- The default GGUF is a community quantization of the official model, not an artifact published by Qwen.
- Model/runtime upgrades can change scores and should be benchmarked before changing defaults.
