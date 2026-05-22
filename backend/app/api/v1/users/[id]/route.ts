import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies, hashPassword } from "@/lib/auth";
import { ok, error, forbidden, unauthorized, notFound, serverError } from "@/lib/api-response";

// PATCH /api/v1/users/:id — Update user (ADMIN only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return unauthorized();
    if (session.role !== "ADMIN") return forbidden("Accès réservé aux administrateurs");

    const { id } = await params;
    const body = await req.json();
    const { username, password, role } = body;

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) return notFound("Utilisateur introuvable");

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (username && username !== existing.username) {
      if (username.length < 3) {
        return error("Le nom d'utilisateur doit contenir au moins 3 caractères");
      }
      const taken = await prisma.adminUser.findUnique({ where: { username } });
      if (taken) return error("Ce nom d'utilisateur est déjà pris");
      updateData.username = username;
    }

    if (password) {
      if (password.length < 6) {
        return error("Le mot de passe doit contenir au moins 6 caractères");
      }
      updateData.passwordHash = await hashPassword(password);
    }

    if (role) {
      const validRoles = ["ADMIN", "USER"];
      if (!validRoles.includes(role)) {
        return error("Rôle invalide");
      }
      // Prevent removing the last admin
      if (existing.role === "ADMIN" && role === "USER") {
        const adminCount = await prisma.adminUser.count({ where: { role: "ADMIN" } });
        if (adminCount <= 1) {
          return error("Impossible de rétrograder le dernier administrateur");
        }
      }
      updateData.role = role;
    }

    if (Object.keys(updateData).length === 0) {
      return error("Aucune modification fournie");
    }

    const updated = await prisma.adminUser.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        lastSeenAt: true,
      },
    });

    return ok(updated);
  } catch (e) {
    console.error("Update user error:", e);
    return serverError();
  }
}

// DELETE /api/v1/users/:id — Delete user (ADMIN only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return unauthorized();
    if (session.role !== "ADMIN") return forbidden("Accès réservé aux administrateurs");

    const { id } = await params;

    // Cannot delete yourself
    if (id === session.sub) {
      return error("Vous ne pouvez pas supprimer votre propre compte");
    }

    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) return notFound("Utilisateur introuvable");

    // Prevent deleting the last admin
    if (existing.role === "ADMIN") {
      const adminCount = await prisma.adminUser.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return error("Impossible de supprimer le dernier administrateur");
      }
    }

    await prisma.adminUser.delete({ where: { id } });

    return ok({ message: "Utilisateur supprimé" });
  } catch (e) {
    console.error("Delete user error:", e);
    return serverError();
  }
}
