import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies, hashPassword } from "@/lib/auth";
import { ok, error, forbidden, unauthorized, serverError } from "@/lib/api-response";

// GET /api/v1/users — List all users (ADMIN only)
export async function GET() {
  try {
    const session = await getSessionFromCookies();
    if (!session) return unauthorized();
    if (session.role !== "ADMIN") return forbidden("Accès réservé aux administrateurs");

    const users = await prisma.adminUser.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        lastSeenAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return ok(users);
  } catch (e) {
    console.error("List users error:", e);
    return serverError();
  }
}

// POST /api/v1/users — Create a new user (ADMIN only)
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromCookies();
    if (!session) return unauthorized();
    if (session.role !== "ADMIN") return forbidden("Accès réservé aux administrateurs");

    const body = await req.json();
    const { username, password, role } = body;

    if (!username || !password) {
      return error("Le nom d'utilisateur et le mot de passe sont requis");
    }

    if (username.length < 3) {
      return error("Le nom d'utilisateur doit contenir au moins 3 caractères");
    }

    if (password.length < 6) {
      return error("Le mot de passe doit contenir au moins 6 caractères");
    }

    const validRoles = ["ADMIN", "USER"];
    const userRole = validRoles.includes(role) ? role : "USER";

    // Check if username already exists
    const existing = await prisma.adminUser.findUnique({ where: { username } });
    if (existing) {
      return error("Ce nom d'utilisateur est déjà pris");
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        role: userRole,
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    return ok(user, 201);
  } catch (e) {
    console.error("Create user error:", e);
    return serverError();
  }
}
