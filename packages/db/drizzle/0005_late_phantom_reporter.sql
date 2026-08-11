CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"repository_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"source_reference" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"path" text,
	"commit_sha" text,
	"start_line" integer,
	"end_line" integer,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_source_type_check" CHECK ("document_chunks"."source_type" in ('issue', 'issue_comment', 'pull_request', 'review', 'commit', 'source_code')),
	CONSTRAINT "document_chunks_chunk_index_check" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_temporal_range_check" CHECK ("document_chunks"."superseded_at" is null or "document_chunks"."superseded_at" >= "document_chunks"."available_at"),
	CONSTRAINT "document_chunks_line_range_check" CHECK (("document_chunks"."start_line" is null and "document_chunks"."end_line" is null) or ("document_chunks"."start_line" >= 1 and "document_chunks"."end_line" >= "document_chunks"."start_line")),
	CONSTRAINT "document_chunks_source_code_provenance_check" CHECK ("document_chunks"."source_type" <> 'source_code' or ("document_chunks"."path" is not null and "document_chunks"."commit_sha" is not null))
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"source_version" text NOT NULL,
	"source_reference" text NOT NULL,
	"title" text,
	"content_hash" text NOT NULL,
	"chunking_strategy" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"path" text,
	"commit_sha" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_repository_id_id_unique" UNIQUE("repository_id","id"),
	CONSTRAINT "documents_source_type_check" CHECK ("documents"."source_type" in ('issue', 'issue_comment', 'pull_request', 'review', 'commit', 'source_code')),
	CONSTRAINT "documents_temporal_range_check" CHECK ("documents"."superseded_at" is null or "documents"."superseded_at" >= "documents"."available_at"),
	CONSTRAINT "documents_source_code_provenance_check" CHECK ("documents"."source_type" <> 'source_code' or ("documents"."path" is not null and "documents"."commit_sha" is not null)),
	CONSTRAINT "documents_commit_provenance_check" CHECK ("documents"."source_type" <> 'commit' or "documents"."commit_sha" is not null)
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_repository_document_foreign_key" FOREIGN KEY ("repository_id","document_id") REFERENCES "public"."documents"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_repository_document_index_unique" ON "document_chunks" USING btree ("repository_id","document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_repository_available_at_index" ON "document_chunks" USING btree ("repository_id","available_at","superseded_at");--> statement-breakpoint
CREATE INDEX "document_chunks_repository_source_type_index" ON "document_chunks" USING btree ("repository_id","source_type");--> statement-breakpoint
CREATE INDEX "document_chunks_repository_path_index" ON "document_chunks" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "document_chunks_repository_commit_sha_index" ON "document_chunks" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_repository_source_version_unique" ON "documents" USING btree ("repository_id","source_type","source_entity_id","source_version");--> statement-breakpoint
CREATE INDEX "documents_repository_available_at_index" ON "documents" USING btree ("repository_id","available_at","superseded_at");--> statement-breakpoint
CREATE INDEX "documents_repository_source_type_index" ON "documents" USING btree ("repository_id","source_type");--> statement-breakpoint
CREATE INDEX "documents_repository_path_index" ON "documents" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "documents_repository_commit_sha_index" ON "documents" USING btree ("repository_id","commit_sha");