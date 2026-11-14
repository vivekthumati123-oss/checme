import {
  ScmProviderType
} from "./scmProviderType";


// =========================================================
// COMMON SCM EVENT TYPES
// =========================================================

export type ScmEventType =
  | "ping"
  | "push"
  | "pull_request"
  | "pull_request_created"
  | "pull_request_updated"
  | "unknown";


// =========================================================
// COMMON SCM EVENT REPOSITORY
// =========================================================

export interface ScmEventRepository {

  id?: string;

  name?: string;

  fullName?: string;

  url?: string;
}


// =========================================================
// COMMON SCM EVENT
// =========================================================

export interface ScmEvent {

  // =======================================================
  // EVENT IDENTIFIERS
  // =======================================================

  id?: string;

  deliveryId?: string;


  // =======================================================
  // PROVIDER / EVENT
  // =======================================================

  provider:
    ScmProviderType;

  type:
    ScmEventType;

  action?: string;
  rawEventType?: string;


  // =======================================================
  // REPOSITORY
  // =======================================================

  repository?:
    ScmEventRepository;

  repositoryId?: string;

  repositoryName?: string;


  // =======================================================
  // ACTOR / SENDER
  // =======================================================

  sender?: string;


  // =======================================================
  // BRANCH / PUSH
  // =======================================================

  branch?: string;

  beforeSha?: string;

  afterSha?: string;


  // =======================================================
  // PULL REQUEST
  // =======================================================

  pullRequestNumber?: number;

  sourceBranch?: string;

  targetBranch?: string;

  sourceSha?: string;

  targetSha?: string;


  // =======================================================
  // EVENT METADATA
  // =======================================================

  occurredAt?: string;
}