# Optional local reranking

## Scope

Reranking is an explicit post-retrieval stage:

```text
query
  ├─ dense top 30
  └─ lexical top 30
          ↓
   Reciprocal Rank Fusion
          ↓
  top 30 unique candidates
          ↓
   local cross-encoder
          ↓
      final top K
```

It does not replace dense, lexical, or hybrid retrieval and cannot introduce a document that was absent from the fused candidate pool. Search without `--rerank` uses the existing hybrid path unchanged.

`@swega/reranking` defines a small provider-neutral `Reranker` contract over a query and candidate texts. `@swega/retrieval` owns conversion from `MemorySearchResult` to the minimal relevance text and attaches `rrfRank`, `rerankerScore`, `rerankerRank`, and `finalRank` while preserving `rrfScore`, branch ranks, scores, and provenance.

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

Reranked searches currently accept a final limit up to the 30-candidate pool. Debug output preserves original RRF score/rank, reranker score/rank, and final rank.

When `RERANKER_PROVIDER` is configured, `swega doctor` sends two harmless health-check strings and reports reranker provider, model, endpoint, status, and a startup action on failure. With no configured reranker, doctor retains its embedding/database-only behavior.

## Formbricks smoke comparison

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

The session-implementation case stayed at rank 1, with `apps/web/modules/auth/lib/session.ts` scoring 0.972. Four cases had unchanged hits or misses. Recall did not improve because no new candidates enter after RRF. Eight cases are a smoke test, not statistically meaningful evidence for a default ranking change.

## Observed resources and latency

Measurements were taken on an arm64 Mac with 16 GB unified memory, llama.cpp build 9960, Qwen3 Q4_K_M, one 4,096-token slot, PostgreSQL and Ollama already running:

| Operation                                 | Wall time |
| ----------------------------------------- | --------: |
| Hybrid query, top 10                      |    1.00 s |
| Same query, rerank 30 → top 10            |   18.52 s |
| Eight-case benchmark with four strategies |  190.48 s |

These are single smoke measurements, not a latency benchmark. The cached model used 378 MiB on disk and the idle server showed approximately 855 MiB resident memory after evaluation. At least 2 GiB of available memory is recommended for the one-slot profile. Four automatic slots exhausted Metal memory on the measured 16 GB system under its existing workload.

## Known failure modes

- Relevant material outside the top 30 hybrid candidates cannot be recovered.
- A general relevance model can prefer tests or prose over the exact implementation and can make individual queries worse.
- Full code chunks make CPU/Metal inference slow; smaller context or a smaller model trades quality for latency and must be evaluated.
- llama.cpp returns an explicit error when a prompt exceeds its physical batch; use the documented matching `--batch-size` and `--ubatch-size` values.
- A server started with too many parallel slots can exhaust unified/GPU memory.
- The default GGUF is a community quantization of the official model, not an artifact published by Qwen.
- Model/runtime upgrades can change scores and should be benchmarked before changing defaults.
