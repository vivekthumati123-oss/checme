// =========================================================
// GITLAB WEBHOOK EVENT TYPES
// =========================================================


export interface GitLabEventProject {

  id?:
    number;

  name?:
    string;

  path_with_namespace?:
    string;

  web_url?:
    string;

  default_branch?:
    string;
}


export interface GitLabEventUser {

  id?:
    number;

  name?:
    string;

  username?:
    string;

  email?:
    string;
}


// =========================================================
// PUSH EVENT
// =========================================================

export interface GitLabPushEvent {

  object_kind:
    "push";

  event_name?:
    string;

  before?:
    string;

  after?:
    string;

  ref?:
    string;

  checkout_sha?:
    string | null;

  user_id?:
    number;

  user_name?:
    string;

  user_username?:
    string;

  project?:
    GitLabEventProject;

  repository?: {
    name?:
      string;

    url?:
      string;

    homepage?:
      string;
  };

  commits?:
    Array<{
      id?:
        string;

      message?:
        string;

      timestamp?:
        string;

      url?:
        string;
    }>;

  total_commits_count?:
    number;
}


// =========================================================
// MERGE REQUEST ATTRIBUTES
// =========================================================

export interface GitLabMergeRequestAttributes {

  id?:
    number;

  iid?:
    number;

  title?:
    string;

  description?:
    string;

  action?:
    string;

  state?:
    string;

  source_branch?:
    string;

  target_branch?:
    string;

  source?: {
    id?:
      number;

    name?:
      string;

    path_with_namespace?:
      string;

    web_url?:
      string;

    default_branch?:
      string;
  };

  target?: {
    id?:
      number;

    name?:
      string;

    path_with_namespace?:
      string;

    web_url?:
      string;

    default_branch?:
      string;
  };

  last_commit?: {
    id?:
      string;

    message?:
      string;

    timestamp?:
      string;

    url?:
      string;
  };

  created_at?:
    string;

  updated_at?:
    string;

  url?:
    string;
}


// =========================================================
// MERGE REQUEST EVENT
// =========================================================

export interface GitLabMergeRequestEvent {

  object_kind:
    "merge_request";

  event_type?:
    string;

  user?:
    GitLabEventUser;

  project?:
    GitLabEventProject;

  object_attributes:
    GitLabMergeRequestAttributes;
}


// =========================================================
// GENERIC / KNOWN EVENT
// =========================================================

export interface GitLabUnknownEvent {

  object_kind?:
    string;

  event_name?:
    string;

  event_type?:
    string;

  project?:
    GitLabEventProject;

  user?:
    GitLabEventUser;

  [key: string]:
    unknown;
}


export type GitLabKnownEvent =
  | GitLabPushEvent
  | GitLabMergeRequestEvent;


// =========================================================
// TYPE GUARDS
// =========================================================

export function isGitLabPushEvent(
  event: unknown
): event is GitLabPushEvent {

  if (
    typeof event !== "object" ||
    event === null
  ) {

    return false;
  }


  return (
    "object_kind" in event &&
    event.object_kind === "push"
  );
}


export function isGitLabMergeRequestEvent(
  event: unknown
): event is GitLabMergeRequestEvent {

  if (
    typeof event !== "object" ||
    event === null
  ) {

    return false;
  }


  return (
    "object_kind" in event &&
    event.object_kind === "merge_request"
  );
}