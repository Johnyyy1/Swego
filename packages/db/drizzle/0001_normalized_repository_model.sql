CREATE TABLE "commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"sha" text NOT NULL,
	"message" text NOT NULL,
	"author" text NOT NULL,
	"author_email" text,
	"authored_at" timestamp with time zone NOT NULL,
	"committed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issue_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"body" text,
	"author" text,
	"created_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"number" integer,
	"title" text NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"author" text,
	"created_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "issues_state_check" CHECK ("issues"."state" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "pull_request_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"path" text NOT NULL,
	"status" text NOT NULL,
	"additions" integer DEFAULT 0 NOT NULL,
	"deletions" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pull_request_files_status_check" CHECK ("pull_request_files"."status" in ('added', 'modified', 'deleted', 'renamed', 'copied', 'changed', 'unchanged')),
	CONSTRAINT "pull_request_files_additions_check" CHECK ("pull_request_files"."additions" >= 0),
	CONSTRAINT "pull_request_files_deletions_check" CHECK ("pull_request_files"."deletions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"number" integer,
	"title" text NOT NULL,
	"body" text,
	"state" text NOT NULL,
	"author" text,
	"base_branch" text NOT NULL,
	"head_branch" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"merged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pull_requests_state_check" CHECK ("pull_requests"."state" in ('open', 'closed', 'merged')),
	CONSTRAINT "pull_requests_merged_at_check" CHECK ("pull_requests"."merged_at" is null or "pull_requests"."state" = 'merged')
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"pull_request_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"body" text,
	"author" text,
	"state" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reviews_state_check" CHECK ("reviews"."state" in ('pending', 'approved', 'changes_requested', 'commented', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "repositories" RENAME COLUMN "host" TO "provider";--> statement-breakpoint
ALTER TABLE "repositories" RENAME COLUMN "clone_url" TO "url";--> statement-breakpoint
ALTER TABLE "repositories" RENAME COLUMN "last_indexed_at" TO "indexed_at";--> statement-breakpoint
DROP INDEX "repositories_host_owner_name_unique";--> statement-breakpoint
DROP INDEX "repositories_last_indexed_at_index";--> statement-breakpoint
ALTER TABLE "repositories" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "provider_id" text;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commits" ADD CONSTRAINT "commits_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commits_repository_sha_unique" ON "commits" USING btree ("repository_id","sha");--> statement-breakpoint
CREATE INDEX "commits_repository_authored_at_index" ON "commits" USING btree ("repository_id","authored_at");--> statement-breakpoint
CREATE INDEX "commits_repository_committed_at_index" ON "commits" USING btree ("repository_id","committed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comments_repository_provider_id_unique" ON "issue_comments" USING btree ("repository_id","provider_id");--> statement-breakpoint
CREATE INDEX "issue_comments_repository_issue_created_at_index" ON "issue_comments" USING btree ("repository_id","issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_comments_repository_created_at_index" ON "issue_comments" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_comments_repository_source_updated_at_index" ON "issue_comments" USING btree ("repository_id","source_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repository_id_id_unique" ON "issues" USING btree ("repository_id","id");--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_repository_issue_foreign_key" FOREIGN KEY ("repository_id","issue_id") REFERENCES "public"."issues"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repository_provider_id_unique" ON "issues" USING btree ("repository_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_repository_number_unique" ON "issues" USING btree ("repository_id","number") WHERE "issues"."number" is not null;--> statement-breakpoint
CREATE INDEX "issues_repository_created_at_index" ON "issues" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "issues_repository_source_updated_at_index" ON "issues" USING btree ("repository_id","source_updated_at");--> statement-breakpoint
CREATE INDEX "issues_repository_state_index" ON "issues" USING btree ("repository_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_files_repository_pull_request_path_unique" ON "pull_request_files" USING btree ("repository_id","pull_request_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_id_id_unique" ON "pull_requests" USING btree ("repository_id","id");--> statement-breakpoint
ALTER TABLE "pull_request_files" ADD CONSTRAINT "pull_request_files_repository_pull_request_foreign_key" FOREIGN KEY ("repository_id","pull_request_id") REFERENCES "public"."pull_requests"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_repository_pull_request_foreign_key" FOREIGN KEY ("repository_id","pull_request_id") REFERENCES "public"."pull_requests"("repository_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_provider_id_unique" ON "pull_requests" USING btree ("repository_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repository_number_unique" ON "pull_requests" USING btree ("repository_id","number") WHERE "pull_requests"."number" is not null;--> statement-breakpoint
CREATE INDEX "pull_requests_repository_created_at_index" ON "pull_requests" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_source_updated_at_index" ON "pull_requests" USING btree ("repository_id","source_updated_at");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_state_index" ON "pull_requests" USING btree ("repository_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_repository_provider_id_unique" ON "reviews" USING btree ("repository_id","provider_id");--> statement-breakpoint
CREATE INDEX "reviews_repository_pull_request_created_at_index" ON "reviews" USING btree ("repository_id","pull_request_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_repository_created_at_index" ON "reviews" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_repository_source_updated_at_index" ON "reviews" USING btree ("repository_id","source_updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_provider_provider_id_unique" ON "repositories" USING btree ("provider","provider_id") WHERE "repositories"."provider_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_provider_owner_name_unique" ON "repositories" USING btree ("provider","owner","name");--> statement-breakpoint
CREATE INDEX "repositories_url_index" ON "repositories" USING btree ("url");--> statement-breakpoint
CREATE INDEX "repositories_indexed_at_index" ON "repositories" USING btree ("indexed_at");--> statement-breakpoint
ALTER TABLE "repositories" DROP COLUMN "updated_at";
