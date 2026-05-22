import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  verifyPassword,
  createSessionToken,
  COOKIE_NAME,
  SESSION_DURATION,
} from "@/lib/auth";
import { ok, error, serverError } from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return error("Username and password are required");
    }

    const user = await prisma.adminUser.findUnique({ where: { username } });
    if (!user) {
      return error("Invalid credentials", 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return error("Invalid credentials", 401);
    }

    // Update lastSeenAt on login
    await prisma.adminUser.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    const token = await createSessionToken(user.id, user.role);

    const response = ok({ token, message: "Logged in successfully" });
    response.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_DURATION,
      path: "/",
    });

    return response;
  } catch (e) {
    console.error("Login error:", e);
    return serverError();
  }
}
