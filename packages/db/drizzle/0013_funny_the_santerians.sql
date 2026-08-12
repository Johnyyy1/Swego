CREATE TABLE "source_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" uuid NOT NULL,
	"source_document_id" text NOT NULL,
	"target_document_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"source_path" text NOT NULL,
	"target_path" text NOT NULL,
	"source_symbol" text,
	"target_symbol" text,
	"language" text NOT NULL,
	"source_commit_sha" text NOT NULL,
	"target_commit_sha" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone,
	"provenance" text NOT NULL,
	"reason" text NOT NULL,
	"source_start_line" integer NOT NULL,
	"confidence" integer NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_relationships_type_check" CHECK ("source_relationships"."relationship_type" in ('imports', 'reexports')),
	CONSTRAINT "source_relationships_temporal_range_check" CHECK ("source_relationships"."superseded_at" is null or "source_relationships"."superseded_at" >= "source_relationships"."available_at"),
	CONSTRAINT "source_relationships_line_check" CHECK ("source_relationships"."source_start_line" >= 1),
	CONSTRAINT "source_relationships_confidence_check" CHECK ("source_relationships"."confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_repository_source_document_foreign_key" FOREIGN KEY ("repository_id","source_document_id") REFERENCES "public"."documents"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_repository_target_document_foreign_key" FOREIGN KEY ("repository_id","target_document_id") REFERENCES "public"."documents"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "source_relationships_repository_source_index" ON "source_relationships" USING btree ("repository_id","source_document_id","available_at");--> statement-breakpoint
CREATE INDEX "source_relationships_repository_target_index" ON "source_relationships" USING btree ("repository_id","target_document_id","available_at");