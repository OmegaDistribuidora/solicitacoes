import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { requireAdmin, requireAuth } from "../lib/security";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/audit", { preHandler: [requireAuth, requireAdmin] }, async () => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 200
    });
    return { logs };
  });
}
