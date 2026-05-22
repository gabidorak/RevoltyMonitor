import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies, hashApiKey } from "@/lib/auth";
import { generateApiKey, getKeyHint } from "@/lib/generate-key";
import {
  ok,
  error,
  unauthorized,
  serverError,
} from "@/lib/api-response";

// GET /api/v1/devices - list all devices
export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const devices = await prisma.device.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      apiKeyHint: true,
      serial: true,
      location: true,
      isActive: true,
      createdAt: true,
      lastSeenAt: true,
      _count: { select: { snapshots: true } },
    },
  });

  return ok(devices);
}

// POST /api/v1/devices - create a new device + generate API key
export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  try {
    const body = await req.json();
    const { name, description, location } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return error("Device name is required");
    }

    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const keyHint = getKeyHint(rawKey);

    const device = await prisma.device.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        location: location?.trim() || null,
        apiKeyHash: keyHash,
        apiKeyHint: keyHint,
      },
    });

    // Return the raw key ONLY once — it won't be retrievable afterwards
    return ok(
      {
        id: device.id,
        name: device.name,
        description: device.description,
        location: device.location,
        apiKey: rawKey, // Only returned at creation
        apiKeyHint: device.apiKeyHint,
        createdAt: device.createdAt,
      },
      201
    );
  } catch (e) {
    console.error("Create device error:", e);
    return serverError();
  }
}
