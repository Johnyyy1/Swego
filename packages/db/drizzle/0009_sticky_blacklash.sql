ALTER TABLE "document_chunks" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "symbol_id" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "symbol_name" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "symbol_kind" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parent_symbol" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "symbol_part" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "symbol_part_count" integer;--> statement-breakpoint
DROP INDEX "document_chunks_search_vector_gin_index";--> statement-breakpoint
ALTER TABLE "document_chunks" drop column "search_vector";--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("path", '') || ' ' || coalesce("symbol_name", '')), 'A') || setweight(to_tsvector('english', coalesce("content", '')), 'B') || setweight(to_tsvector('simple', coalesce("parent_symbol", '')), 'C') || setweight(to_tsvector('simple', coalesce("source_type", '') || ' ' || coalesce("source_reference", '') || ' ' || coalesce("language", '') || ' ' || coalesce("symbol_kind", '')), 'D')) STORED;--> statement-breakpoint
CREATE INDEX "document_chunks_search_vector_gin_index" ON "document_chunks" USING gin ("search_vector");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_symbol_metadata_check" CHECK (("document_chunks"."symbol_id" is null and "document_chunks"."symbol_kind" is null and "document_chunks"."symbol_part" is null and "document_chunks"."symbol_part_count" is null and "document_chunks"."parent_symbol" is null) or ("document_chunks"."symbol_id" is not null and "document_chunks"."symbol_kind" is not null and "document_chunks"."symbol_part" >= 1 and "document_chunks"."symbol_part_count" >= "document_chunks"."symbol_part"));--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_symbol_kind_check" CHECK ("document_chunks"."symbol_kind" is null or "document_chunks"."symbol_kind" in ('class', 'enum', 'function', 'interface', 'method', 'module', 'property', 'type', 'variable'));
