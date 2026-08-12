CREATE INDEX "document_chunks_structural_search_vector_gin_index" ON "document_chunks" USING gin ("structural_search_vector");
