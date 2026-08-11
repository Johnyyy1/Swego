CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_repository_id_unique" UNIQUE("repository_id","id");
--> statement-breakpoint
CREATE TABLE "chunk_embeddings" (
	"chunk_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"dimensions" integer NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"embedded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunk_embeddings_repository_chunk_primary_key" PRIMARY KEY("repository_id","chunk_id"),
	CONSTRAINT "chunk_embeddings_dimensions_check" CHECK ("chunk_embeddings"."dimensions" = 512)
);
--> statement-breakpoint
ALTER TABLE "chunk_embeddings" ADD CONSTRAINT "chunk_embeddings_repository_chunk_foreign_key" FOREIGN KEY ("repository_id","chunk_id") REFERENCES "public"."document_chunks"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunk_embeddings_repository_provider_model_index" ON "chunk_embeddings" USING btree ("repository_id","provider","model");--> statement-breakpoint
CREATE INDEX "chunk_embeddings_embedding_hnsw_index" ON "chunk_embeddings" USING hnsw ("embedding" vector_cosine_ops);
