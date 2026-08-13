ALTER TABLE "source_relationships" ADD COLUMN "imported_name" text;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "local_name" text;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "exposed_name" text;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "binding_kind" text DEFAULT 'named' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "is_type_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "resolution" text DEFAULT 'exact_module' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "module_resolution_kind" text DEFAULT 'relative' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "target_symbol_kind" text;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "target_start_line" integer;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "target_end_line" integer;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "configuration_path" text;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD COLUMN "configuration_commit_sha" text;--> statement-breakpoint
UPDATE "source_relationships" SET "target_symbol" = null;--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_binding_kind_check" CHECK ("source_relationships"."binding_kind" in ('named', 'default', 'namespace', 'side_effect', 'export_star'));--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_resolution_check" CHECK ("source_relationships"."resolution" in ('exact_symbol', 'exact_module'));--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_module_resolution_kind_check" CHECK ("source_relationships"."module_resolution_kind" in ('relative', 'path_alias', 'base_url'));--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_exact_target_check" CHECK (("source_relationships"."resolution" = 'exact_symbol' and "source_relationships"."target_symbol" is not null and "source_relationships"."target_symbol_kind" is not null and "source_relationships"."target_start_line" >= 1 and "source_relationships"."target_end_line" >= "source_relationships"."target_start_line") or ("source_relationships"."resolution" = 'exact_module' and "source_relationships"."target_symbol" is null and "source_relationships"."target_symbol_kind" is null and "source_relationships"."target_start_line" is null and "source_relationships"."target_end_line" is null));--> statement-breakpoint
ALTER TABLE "source_relationships" ADD CONSTRAINT "source_relationships_configuration_provenance_check" CHECK (("source_relationships"."module_resolution_kind" = 'relative' and "source_relationships"."configuration_path" is null and "source_relationships"."configuration_commit_sha" is null) or ("source_relationships"."module_resolution_kind" <> 'relative' and "source_relationships"."configuration_path" is not null and "source_relationships"."configuration_commit_sha" is not null));
