import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { requireAuth } from "../lib/security";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard", { preHandler: [requireAuth] }, async () => {
    const [users, rcas, entries, pendingRequests] = await Promise.all([
      prisma.user.count({ where: { active: true } }),
      prisma.baseRca.count(),
      prisma.routingEntry.count(),
      prisma.routeRequest.count({ where: { status: "PENDING" } })
    ]);

    return { users, rcas, entries, pendingRequests };
  });
}
