import { getSessionFromCookies } from "@/lib/auth";
import { ok, unauthorized } from "@/lib/api-response";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();
  return ok({ userId: session.sub, role: session.role });
}
