import prisma from "./prisma";
import { env } from "../config";

export async function ensureAdminUser(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { username: env.adminUsername }
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: env.adminUsername,
        displayName: env.adminDisplayName,
        role: "ADMIN",
        active: true
      }
    });
    return;
  }

  if (existing.role !== "ADMIN" || !existing.active) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "ADMIN",
        active: true
      }
    });
  }
}
