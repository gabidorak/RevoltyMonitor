import { getSessionFromCookies } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ok, unauthorized } from "@/lib/api-response";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const user = await prisma.adminUser.findUnique({
    where: { id: session.sub },
    select: { id: true, username: true, role: true, lastSeenAt: true },
  });

  if (!user) return unauthorized();

  return ok({
    userId: user.id,
    username: user.username,
    role: user.role,
    lastSeenAt: user.lastSeenAt,
  });
}
