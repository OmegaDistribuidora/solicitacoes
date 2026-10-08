import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../lib/audit";
import { requireAuth, requireModuleAccess, requirePromoterRouteReviewer } from "../../lib/security";
import { nowFortaleza } from "../../lib/dates";

const VALID_DAYS = [
  "Segunda-Feira",
  "Ter\u00e7a-Feira",
  "Quarta-Feira",
  "Quinta-Feira",
  "Sexta-Feira",
  "S\u00e1bado"
] as const;

const nullableText = z.string().trim().max(500).optional().nullable();
const routeDataSchema = z
  .object({
    codpromotor: nullableText,
    promotor: nullableText,
    areaatuacao: nullableText,
    codcli: z.coerce.number().int().positive(),
    cliente: nullableText,
    frequencia: nullableText,
    dia: z.enum(VALID_DAYS).optional().nullable(),
    status: nullableText,
    obs: z.string().trim().max(2000).optional().nullable()
  })
  .superRefine((data, context) => {
    if (Boolean(data.frequencia) !== Boolean(data.dia)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Frequencia e dia devem ser informados juntos.",
        path: data.frequencia ? ["dia"] : ["frequencia"]
      });
    }
  });

const createRequestSchema = z.object({
  action: z.enum(["CREATE", "UPDATE", "DELETE"]),
  sourceId: z.string().uuid().optional().nullable(),
  data: routeDataSchema.optional().nullable()
});

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().max(1000).optional().default("")
});

function cleanText(value: string | null | undefined): string | null {
  const cleaned = String(value || "").trim();
  return cleaned || null;
}

function normalizeRouteData(data: z.infer<typeof routeDataSchema>) {
  return {
    codpromotor: cleanText(data.codpromotor),
    promotor: cleanText(data.promotor),
    areaatuacao: cleanText(data.areaatuacao),
    codcli: data.codcli,
    cliente: cleanText(data.cliente),
    frequencia: cleanText(data.frequencia),
    dia: data.dia || null,
    status: cleanText(data.status),
    obs: cleanText(data.obs)
  };
}

function snapshot(entry: any) {
  return {
    sourceId: entry.sourceId,
    codpromotor: entry.codpromotor,
    promotor: entry.promotor,
    areaatuacao: entry.areaatuacao,
    codcli: entry.codcli,
    cliente: entry.cliente,
    frequencia: entry.frequencia,
    dia: entry.dia,
    status: entry.status,
    obs: entry.obs,
    dataInsercao: entry.dataInsercao?.toISOString?.() || entry.dataInsercao || null,
    sourceUpdatedAt: entry.sourceUpdatedAt?.toISOString?.() || entry.sourceUpdatedAt || null
  };
}

export async function registerRotaPromotorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/modules/rota-promotor")) return;
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireModuleAccess(request, reply, "ROTA_PROMOTOR");
  });

  app.get("/api/modules/rota-promotor/meta", async () => ({ days: VALID_DAYS }));

  app.get("/api/modules/rota-promotor/entries", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const q = String(query.q || "").trim();
    const page = Math.max(1, Number(query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 30) || 30));
    const numericQuery = Number(q);
    const where: any = q
      ? {
          OR: [
            { promotor: { contains: q, mode: "insensitive" } },
            { cliente: { contains: q, mode: "insensitive" } },
            { areaatuacao: { contains: q, mode: "insensitive" } },
            { codpromotor: { contains: q, mode: "insensitive" } },
            { codcli: Number.isInteger(numericQuery) ? numericQuery : -1 }
          ]
        }
      : {};

    const [total, entries] = await Promise.all([
      prisma.promoterRouteEntry.count({ where }),
      prisma.promoterRouteEntry.findMany({
        where,
        orderBy: [{ promotor: "asc" }, { cliente: "asc" }, { dia: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), entries };
  });

  app.get("/api/modules/rota-promotor/requests", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const query = request.query as Record<string, string | undefined>;
    const status = query.status === "ALL" ? undefined : query.status || "PENDING";
    const requests = await prisma.promoterRouteRequest.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(authUser.role === "SUPERVISOR" ? { requesterUserId: authUser.userId } : {})
      },
      include: { requesterUser: true, reviewerUser: true },
      orderBy: { createdAt: "desc" },
      take: 150
    });
    return { requests };
  });

  app.post("/api/modules/rota-promotor/requests", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const parsed = createRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: parsed.error.issues[0]?.message || "Dados invalidos." });
    }

    const { action } = parsed.data;
    if (action === "CREATE" && !parsed.data.data) {
      return reply.code(400).send({ message: "Dados da nova rota sao obrigatorios." });
    }
    if (action !== "CREATE" && !parsed.data.sourceId) {
      return reply.code(400).send({ message: "Registro de origem obrigatorio." });
    }
    if (action === "UPDATE" && !parsed.data.data) {
      return reply.code(400).send({ message: "Dados da alteracao sao obrigatorios." });
    }

    const sourceId = action === "CREATE" ? randomUUID() : String(parsed.data.sourceId);
    const current = action === "CREATE" ? null : await prisma.promoterRouteEntry.findUnique({ where: { sourceId } });
    if (action !== "CREATE" && !current) {
      return reply.code(404).send({ message: "Registro da rota nao encontrado." });
    }

    const openRequest = await prisma.promoterRouteRequest.findFirst({
      where: { sourceId, status: { in: ["PENDING", "APPROVED"] } }
    });
    if (openRequest) {
      return reply.code(409).send({ message: `Ja existe uma solicitacao aberta para este registro (#${openRequest.id}).` });
    }

    const requestedData = parsed.data.data ? normalizeRouteData(parsed.data.data) : null;
    const created = await prisma.$transaction(async (tx) => {
      const routeRequest = await tx.promoterRouteRequest.create({
        data: {
          action,
          status: "APPROVED",
          sourceId,
          requesterUserId: authUser.userId,
          reviewReason: "Aprovacao automatica.",
          reviewedAt: nowFortaleza(),
          currentData: current ? snapshot(current) : undefined,
          requestedData: requestedData || undefined
        },
        include: { requesterUser: true, reviewerUser: true }
      });

      await recordAudit(
        {
          actor: authUser,
          action: "CREATE_AUTO_APPROVED_PROMOTER_ROUTE_REQUEST",
          entityType: "PROMOTER_ROUTE_REQUEST",
          entityId: routeRequest.id,
          summary: `Solicitacao de rota de promotor ${routeRequest.id} criada e aprovada automaticamente (${action}).`,
          before: current ? snapshot(current) : undefined,
          after: routeRequest
        },
        tx
      );
      return routeRequest;
    });

    return reply.code(201).send({ request: created });
  });

  app.patch(
    "/api/modules/rota-promotor/requests/:id/review",
    { preHandler: [requirePromoterRouteReviewer] },
    async (request, reply) => {
      const authUser = request.authUser;
      if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
      const requestId = Number((request.params as { id: string }).id);
      const parsed = reviewSchema.safeParse(request.body);
      if (!Number.isInteger(requestId) || requestId <= 0 || !parsed.success) {
        return reply.code(400).send({ message: "Revisao invalida." });
      }

      const current = await prisma.promoterRouteRequest.findUnique({ where: { id: requestId } });
      if (!current) return reply.code(404).send({ message: "Solicitacao nao encontrada." });
      if (current.status !== "PENDING") return reply.code(400).send({ message: "Solicitacao ja revisada." });

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.promoterRouteRequest.update({
          where: { id: requestId },
          data: {
            status: parsed.data.decision,
            reviewerUserId: authUser.userId,
            reviewReason: parsed.data.reason || null,
            reviewedAt: nowFortaleza(),
            applyError: null
          },
          include: { requesterUser: true, reviewerUser: true }
        });
        await recordAudit(
          {
            actor: authUser,
            action: parsed.data.decision === "APPROVED" ? "APPROVE_PROMOTER_ROUTE_REQUEST" : "REJECT_PROMOTER_ROUTE_REQUEST",
            entityType: "PROMOTER_ROUTE_REQUEST",
            entityId: requestId,
            summary: `Solicitacao de rota de promotor ${requestId} ${parsed.data.decision === "APPROVED" ? "aprovada" : "recusada"}.`,
            before: current,
            after: result
          },
          tx
        );
        return result;
      });
      return { request: updated };
    }
  );
}
