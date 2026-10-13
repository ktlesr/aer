import { makeRequestId } from "@/lib/api/errors";
import { jsonOk } from "@/lib/api/respond";
import { publishedKeys } from "@/lib/audit/seal";

// Public, unauthenticated: the Ed25519 PUBLIC keys receipts are signed with (active + retired).
// Fetch it once and pin it — a verifier that re-reads this at verification time trusts whoever
// controls this server at that moment, which defeats the point of a signature.
export function GET(): Response {
  return jsonOk({ keys: publishedKeys() }, 200, makeRequestId());
}
