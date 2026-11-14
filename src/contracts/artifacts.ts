export const ARTIFACTS = {
  prepare: { name: "ua-prepare", dir: "prepare" },
  proposed: { name: "ua-proposed", dir: "generate" },
  snapshot1: { name: "ua-snapshot1", dir: "snapshot1" },
  validate1: { name: "ua-validate1", dir: "validate1" },
  repaired: { name: "ua-repaired", dir: "repair" },
  snapshot2: { name: "ua-snapshot2", dir: "snapshot2" },
  validate2: { name: "ua-validate2", dir: "validate2" },
  final: { name: "ua-final", dir: "final" },
} as const;

export type ArtifactKey = keyof typeof ARTIFACTS;
export type ArtifactName = (typeof ARTIFACTS)[ArtifactKey]["name"];
export type ArtifactDir = (typeof ARTIFACTS)[ArtifactKey]["dir"];
export type StageName = "prepare" | "generate" | "validate1" | "repair" | "validate2" | "publish" | "commit";
