CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"clone_url" text NOT NULL,
	"default_branch" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_indexed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_host_owner_name_unique" ON "repositories" USING btree ("host","owner","name");--> statement-breakpoint
CREATE INDEX "repositories_last_indexed_at_index" ON "repositories" USING btree ("last_indexed_at");