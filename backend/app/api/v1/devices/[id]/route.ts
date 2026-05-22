import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromCookies, hashApiKey } from "@/lib/auth";
import { generateApiKey, getKeyHint } from "@/lib/generate-key";
import {
  ok,
  error,
  unauthorized,
  notFound,
  serverError,
} from "@/lib/api-response";

type Params = { params: Promise<{ id: string }> };

// GET /api/v1/devices/:id
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const { id } = await params;
  const device = await prisma.device.findUnique({
    where: { id },
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

  if (!device) return notFound("Device not found");
  return ok(device);
}

// PATCH /api/v1/devices/:id - update name/description/location or revoke/reactivate
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await prisma.device.findUnique({ where: { id } });
  if (!existing) return notFound("Device not found");

  try {
    const body = await req.json();
    const { name, description, location, isActive, regenerateKey } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (location !== undefined) updateData.location = location?.trim() || null;
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);

    let newRawKey: string | undefined;
    if (regenerateKey) {
      newRawKey = generateApiKey();
      updateData.apiKeyHash = await hashApiKey(newRawKey);
      updateData.apiKeyHint = getKeyHint(newRawKey);
    }

    const updated = await prisma.device.update({
      where: { id },
      data: updateData,
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
      },
    });

    return ok({
      ...updated,
      ...(newRawKey ? { apiKey: newRawKey } : {}),
    });
  } catch (e) {
    console.error("Update device error:", e);
    return serverError();
  }
}

// DELETE /api/v1/devices/:id - delete a device and all its snapshots
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSessionFromCookies();
  if (!session) return unauthorized();

  const { id } = await params;
  const existing = await prisma.device.findUnique({ where: { id } });
  if (!existing) return notFound("Device not found");

  try {
    await prisma.device.delete({ where: { id } });
    return ok({ message: "Device deleted" });
  } catch (e) {
    console.error("Delete device error:", e);
    return serverError();
  }
}
