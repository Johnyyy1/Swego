ALTER TABLE "document_chunks" ADD COLUMN "parent_source_type" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parent_source_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "parent_source_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "parent_source_entity_id" uuid;--> statement-breakpoint
CREATE INDEX "document_chunks_repository_parent_source_index" ON "document_chunks" USING btree ("repository_id","parent_source_type","parent_source_entity_id");--> statement-breakpoint
CREATE INDEX "documents_repository_parent_source_index" ON "documents" USING btree ("repository_id","parent_source_type","parent_source_entity_id");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_parent_source_check" CHECK (("document_chunks"."parent_source_type" is null and "document_chunks"."parent_source_entity_id" is null) or ("document_chunks"."parent_source_type" is not null and "document_chunks"."parent_source_entity_id" is not null));--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_parent_source_type_check" CHECK ("document_chunks"."parent_source_type" is null or "document_chunks"."parent_source_type" in ('issue', 'pull_request'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_source_check" CHECK (("documents"."parent_source_type" is null and "documents"."parent_source_entity_id" is null) or ("documents"."parent_source_type" is not null and "documents"."parent_source_entity_id" is not null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_parent_source_type_check" CHECK ("documents"."parent_source_type" is null or "documents"."parent_source_type" in ('issue', 'pull_request'));