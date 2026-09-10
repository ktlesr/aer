/**
 * Operator = a user who may see cross-workspace data (the /ops adoption page). Gated on user ID,
 * not email: signup doesn't verify email ownership, so an allowlisted address that isn't
 * registered yet (a typo, a deleted account) could be claimed by anyone who signs up with it.
 * A user ID is server-assigned and can't be claimed.
 *
 * Fails closed: with AER_OPERATOR_USER_IDS unset or empty, nobody is an operator.
 */
export function isOperator(
  userId: string | null | undefined,
  allowlist: string | undefined = process.env.AER_OPERATOR_USER_IDS,
): boolean {
  if (!userId || !allowlist) return false;
  return allowlist
    .split(",")
    .map((id) => id.trim())
    .includes(userId);
}
