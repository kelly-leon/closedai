function signupDecision(data, error) {
  const message = String(error?.message || error || "").toLowerCase();
  if (message.includes("already registered") || message.includes("user already exists")) return "duplicate";
  if (error && Number(error.status ?? error.statusCode ?? 0) === 429) return "rate-limit";
  if (error) return "error";
  if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) return "duplicate";
  return "new";
}

module.exports = { signupDecision };
