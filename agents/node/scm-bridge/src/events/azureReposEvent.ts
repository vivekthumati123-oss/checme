// =========================================================
// AZURE DEVOPS SERVICE HOOK EVENT
// =========================================================

/**
 * Base Azure DevOps Service Hook event.
 */
export interface AzureReposEvent {
  /**
   * Unique Azure DevOps event identifier.
   */
  id?: string;

  /**
   * Azure DevOps Service Hook event type.
   *
   * Examples:
   * - git.push
   * - git.pullrequest.created
   * - git.pullrequest.updated
   */
  eventType: string;

  /**
   * Event creation timestamp.
   */
  createdDate?: string;

  /**
   * Provider-specific event payload.
   *
   * AzureReposEventNormalizer should convert this resource
   * into the appropriate strongly typed resource based on
   * eventType.
   */
  resource: unknown;
}


// =========================================================
// AZURE DEVOPS REPOSITORY
// =========================================================

/**
 * Common Azure Repos repository information.
 */
export interface AzureReposRepository {
  /**
   * Azure DevOps repository ID.
   */
  id?: string;

  /**
   * Repository name.
   */
  name?: string;

  /**
   * Azure DevOps browser URL.
   */
  webUrl?: string;

  /**
   * Git remote URL.
   */
  remoteUrl?: string;

  /**
   * Default branch.
   *
   * Example:
   * refs/heads/main
   */
  defaultBranch?: string;

  /**
   * SSH clone URL.
   */
  sshUrl?: string;

  /**
   * Azure DevOps project information.
   */
  project?: {
    id?: string;
    name?: string;
  };
}


// =========================================================
// AZURE DEVOPS USER / IDENTITY
// =========================================================

export interface AzureReposIdentity {
  /**
   * Display name of the Azure DevOps user.
   */
  displayName?: string;

  /**
   * Usually email / Azure DevOps unique user name.
   */
  uniqueName?: string;

  /**
   * Azure DevOps identity ID.
   */
  id?: string;
}


// =========================================================
// AZURE DEVOPS COMMIT
// =========================================================

export interface AzureReposCommit {
  /**
   * Git commit SHA.
   */
  commitId?: string;

  /**
   * Commit message / comment.
   */
  comment?: string;

  /**
   * Commit browser URL.
   */
  url?: string;

  /**
   * Commit author.
   */
  author?: {
    name?: string;
    email?: string;
    date?: string;
  };

  /**
   * Committer.
   */
  committer?: {
    name?: string;
    email?: string;
    date?: string;
  };
}


// =========================================================
// AZURE DEVOPS PULL REQUEST EVENT RESOURCE
// =========================================================

export interface AzureReposPullRequestEventResource {
  /**
   * Azure DevOps pull request ID.
   */
  pullRequestId: number;

  /**
   * Pull request title.
   */
  title?: string;

  /**
   * Pull request description.
   */
  description?: string;

  /**
   * Pull request status.
   *
   * Examples:
   * - active
   * - completed
   * - abandoned
   */
  status?: string;

  /**
   * Source branch.
   *
   * Example:
   * refs/heads/feature/my-feature
   */
  sourceRefName?: string;

  /**
   * Target branch.
   *
   * Example:
   * refs/heads/main
   */
  targetRefName?: string;

  /**
   * Indicates whether this is a draft PR.
   */
  isDraft?: boolean;

  /**
   * Pull request creation time.
   */
  creationDate?: string;

  /**
   * Pull request closed time.
   */
  closedDate?: string;

  /**
   * Pull request URL returned by Azure DevOps.
   */
  url?: string;

  // =======================================================
  // SOURCE COMMIT
  // =======================================================

  /**
   * Latest commit from the PR source branch.
   */
  lastMergeSourceCommit?: {
    commitId?: string;
    url?: string;
  };

  // =======================================================
  // TARGET COMMIT
  // =======================================================

  /**
   * Latest target branch commit.
   */
  lastMergeTargetCommit?: {
    commitId?: string;
    url?: string;
  };

  // =======================================================
  // MERGE COMMIT
  // =======================================================

  /**
   * Merge commit created for the pull request.
   */
  lastMergeCommit?: {
    commitId?: string;
    url?: string;
  };

  // =======================================================
  // REPOSITORY
  // =======================================================

  repository?: AzureReposRepository;

  // =======================================================
  // CREATED BY
  // =======================================================

  createdBy?: AzureReposIdentity;

  // =======================================================
  // REVIEWERS
  // =======================================================

  reviewers?: Array<
    AzureReposIdentity & {
      vote?: number;
      isRequired?: boolean;
    }
  >;
}


// =========================================================
// AZURE DEVOPS PUSH REF UPDATE
// =========================================================

/**
 * Represents a branch/reference update contained in
 * an Azure DevOps git.push event.
 *
 * Example:
 *
 * name        = refs/heads/main
 * oldObjectId = commit before push
 * newObjectId = commit after push
 */
export interface AzureReposRefUpdate {
  /**
   * Updated Git ref.
   *
   * Example:
   * refs/heads/main
   */
  name?: string;

  /**
   * Commit SHA before the push.
   */
  oldObjectId?: string;

  /**
   * Commit SHA after the push.
   */
  newObjectId?: string;
}


// =========================================================
// AZURE DEVOPS PUSH EVENT RESOURCE
// =========================================================

export interface AzureReposPushEventResource {
  /**
   * Azure DevOps push ID.
   */
  pushId?: number;

  /**
   * Push creation timestamp.
   */
  date?: string;

  /**
   * Push URL.
   */
  url?: string;

  // =======================================================
  // REPOSITORY
  // =======================================================

  repository?: AzureReposRepository;

  // =======================================================
  // REF UPDATES
  // =======================================================

  /**
   * Git refs modified by the push.
   *
   * Normally:
   * refs/heads/<branch>
   */
  refUpdates?: AzureReposRefUpdate[];

  // =======================================================
  // COMMITS
  // =======================================================

  /**
   * Commits included in the push.
   */
  commits?: AzureReposCommit[];

  // =======================================================
  // PUSHED BY
  // =======================================================

  /**
   * Azure DevOps identity that performed the push.
   */
  pushedBy?: AzureReposIdentity;
}


// =========================================================
// STRONGLY TYPED AZURE DEVOPS EVENTS
// =========================================================

/**
 * Azure Repos push Service Hook event.
 */
export interface AzureReposPushEvent extends AzureReposEvent {
  eventType: "git.push";
  resource: AzureReposPushEventResource;
}


/**
 * Azure Repos pull request created Service Hook event.
 */
export interface AzureReposPullRequestCreatedEvent
  extends AzureReposEvent {
  eventType: "git.pullrequest.created";
  resource: AzureReposPullRequestEventResource;
}


/**
 * Azure Repos pull request updated Service Hook event.
 */
export interface AzureReposPullRequestUpdatedEvent
  extends AzureReposEvent {
  eventType: "git.pullrequest.updated";
  resource: AzureReposPullRequestEventResource;
}


/**
 * Azure Repos pull request merged/completed Service Hook event.
 */
export interface AzureReposPullRequestMergedEvent
  extends AzureReposEvent {
  eventType: "git.pullrequest.merged";
  resource: AzureReposPullRequestEventResource;
}


// =========================================================
// AZURE DEVOPS EVENT TYPE UNION
// =========================================================

/**
 * All Azure Repos Service Hook events currently supported
 * by SCM Bridge.
 */
export type AzureReposKnownEvent =
  | AzureReposPushEvent
  | AzureReposPullRequestCreatedEvent
  | AzureReposPullRequestUpdatedEvent
  | AzureReposPullRequestMergedEvent;


// =========================================================
// TYPE GUARDS
// =========================================================

/**
 * Determines whether the incoming Service Hook is
 * an Azure Repos push event.
 */
export function isAzureReposPushEvent(
  event: AzureReposEvent
): event is AzureReposPushEvent {
  return event.eventType === "git.push";
}


/**
 * Determines whether the incoming Service Hook is
 * an Azure Repos pull request created event.
 */
export function isAzureReposPullRequestCreatedEvent(
  event: AzureReposEvent
): event is AzureReposPullRequestCreatedEvent {
  return event.eventType === "git.pullrequest.created";
}


/**
 * Determines whether the incoming Service Hook is
 * an Azure Repos pull request updated event.
 */
export function isAzureReposPullRequestUpdatedEvent(
  event: AzureReposEvent
): event is AzureReposPullRequestUpdatedEvent {
  return event.eventType === "git.pullrequest.updated";
}


/**
 * Determines whether the incoming Service Hook is
 * an Azure Repos pull request merged event.
 */
export function isAzureReposPullRequestMergedEvent(
  event: AzureReposEvent
): event is AzureReposPullRequestMergedEvent {
  return event.eventType === "git.pullrequest.merged";
}


/**
 * Determines whether the event is any supported
 * Azure Repos pull request event.
 */
export function isAzureReposPullRequestEvent(
  event: AzureReposEvent
): event is
  | AzureReposPullRequestCreatedEvent
  | AzureReposPullRequestUpdatedEvent
  | AzureReposPullRequestMergedEvent {
  return (
    event.eventType === "git.pullrequest.created" ||
    event.eventType === "git.pullrequest.updated" ||
    event.eventType === "git.pullrequest.merged"
  );
}