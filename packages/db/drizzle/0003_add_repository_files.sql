CREATE TABLE "repository_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text,
	"extension" text,
	"size" bigint NOT NULL,
	"last_known_commit_sha" text NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_files_size_check" CHECK ("repository_files"."size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "repository_files" ADD CONSTRAINT "repository_files_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_files_repository_path_unique" ON "repository_files" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "repository_files_repository_language_index" ON "repository_files" USING btree ("repository_id","language");--> statement-breakpoint
CREATE INDEX "repository_files_repository_extension_index" ON "repository_files" USING btree ("repository_id","extension");--> statement-breakpoint
CREATE INDEX "repository_files_repository_commit_sha_index" ON "repository_files" USING btree ("repository_id","last_known_commit_sha");