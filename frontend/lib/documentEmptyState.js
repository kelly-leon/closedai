export function documentEmptyState(documents, queryStatus) {
  if (queryStatus === "loading" || queryStatus === "idle") return "loading";
  if (queryStatus === "error") return "failed";
  if (!Array.isArray(documents)) return "loading";
  if (documents.some(document => document.status === "ready")) return "has-ready";
  if (documents.length === 0) return "empty";
  if (documents.every(document => document.status === "failed")) return "all-failed";
  return "processing";
}
