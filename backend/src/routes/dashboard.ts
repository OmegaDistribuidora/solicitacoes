import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { requireAuth } from "../lib/security";
import { listPromoterRoutes } from "../lib/omegaApi";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard", { preHandler: [requireAuth] }, async () => {
    const [users, rcas, entries, pendingRequests, promoterRoutePage, pendingPromoterRequests, books] = await Promise.all([
      prisma.user.count({ where: { active: true } }),
      prisma.baseRca.count(),
      prisma.routingEntry.count(),
      prisma.routeRequest.count({ where: { status: "PENDING" } }),
      listPromoterRoutes({ page: 1, pageSize: 1, query: "" }),
      prisma.promoterRouteRequest.count({ where: { status: { in: ["PENDING", "APPROVED"] } } }),
      prisma.book.count()
    ]);

    return {
      users,
      rcas,
      entries,
      pendingRequests,
      promoterRoutes: promoterRoutePage.total,
      pendingPromoterRequests,
      books
    };
  });
}
