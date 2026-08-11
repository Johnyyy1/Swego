import { z } from "zod";

export const repositoryIdSchema = z.string().uuid();
export type RepositoryId = z.infer<typeof repositoryIdSchema>;

export const repositoryLocatorSchema = z.object({
  provider: z.string().min(1),
  providerId: z.string().min(1).optional(),
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
});

export type RepositoryLocator = z.infer<typeof repositoryLocatorSchema>;
