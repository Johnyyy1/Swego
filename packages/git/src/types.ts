export interface ManagedRepositoryInput {
  repositoryId: string;
  remoteUrl: string;
}

export interface ManagedGitRepository extends ManagedRepositoryInput {
  directory: string;
}

export interface CheckoutOptions {
  force?: boolean;
}

export interface ReadFileOptions {
  revision?: string;
  maxBytes?: number;
}

export interface GitHistoryOptions {
  revision?: string;
  limit?: number;
  since?: Date;
}

export interface GitCommit {
  hash: string;
  parents: readonly string[];
  authorName: string;
  authorEmail: string;
  authoredAt: Date;
  committedAt: Date;
  subject: string;
  body: string;
}

export interface GitTrackedFile {
  path: string;
  objectSha: string;
  language: string | null;
  extension: string | null;
  size: number;
  lastKnownCommitSha: string;
}

export interface GitRepositoryManager {
  cloneRepository(input: ManagedRepositoryInput): Promise<ManagedGitRepository>;
  updateRepository(repository: ManagedGitRepository): Promise<void>;
  checkoutRevision(
    repository: ManagedGitRepository,
    revision: string,
    options?: CheckoutOptions,
  ): Promise<string>;
  resolveRevision(
    repository: ManagedGitRepository,
    revision: string,
  ): Promise<string>;
  listFiles(
    repository: ManagedGitRepository,
    revision: string,
  ): Promise<readonly GitTrackedFile[]>;
  readFile(
    repository: ManagedGitRepository,
    path: string,
    options?: ReadFileOptions,
  ): Promise<Uint8Array>;
  getCommitHistory(
    repository: ManagedGitRepository,
    options?: GitHistoryOptions,
  ): Promise<readonly GitCommit[]>;
  getFileHistory(
    repository: ManagedGitRepository,
    path: string,
    options?: GitHistoryOptions,
  ): Promise<readonly GitCommit[]>;
}
