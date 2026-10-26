import type { FastifyInstance } from "fastify";
import prisma from "../lib/prisma";
import { requireAuth } from "../lib/security";
import { listPromoterRoutes } from "../lib/omegaApi";

export async function registerDashboardRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/dashboard", { preHandler: [requireAuth] }, async () => {
    const [users, promoterRoutePage, books] = await Promise.all([
      prisma.user.count({ where: { active: true } }),
      listPromoterRoutes({ page: 1, pageSize: 1, query: "" }),
      prisma.book.count()
    ]);

    return {
      users,
      promoterRoutes: promoterRoutePage.total,
      books
    };
  });
}
