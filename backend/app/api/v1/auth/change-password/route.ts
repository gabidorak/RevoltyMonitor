import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies, verifyPassword, hashPassword } from "@/lib/auth";
import { ok, error, unauthorized, serverError } from "@/lib/api-response";

// POST /api/v1/auth/change-password — Change own password (any authenticated user)
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return unauthorized();

    const body = await req.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return error("Le mot de passe actuel et le nouveau mot de passe sont requis");
    }

    if (newPassword.length < 6) {
      return error("Le nouveau mot de passe doit contenir au moins 6 caractères");
    }

    const user = await prisma.adminUser.findUnique({
      where: { id: session.sub },
    });

    if (!user) return unauthorized();

    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) {
      return error("Mot de passe actuel incorrect", 401);
    }

    const newHash = await hashPassword(newPassword);
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    return ok({ message: "Mot de passe modifié avec succès" });
  } catch (e) {
    console.error("Change password error:", e);
    return serverError();
  }
}
