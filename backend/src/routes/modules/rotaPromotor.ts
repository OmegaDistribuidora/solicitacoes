import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../lib/audit";
import { requireAuth, requireModuleAccess } from "../../lib/security";
import { nowFortaleza } from "../../lib/dates";
import { applyPromoterRouteChange, listPromoterRoutes, OmegaApiError } from "../../lib/omegaApi";

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
  expectedUpdatedAt: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Versao do registro invalida.")
    .optional()
    .nullable(),
  data: routeDataSchema.optional().nullable()
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

export async function registerRotaPromotorRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/modules/rota-promotor")) return;
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireModuleAccess(request, reply, "ROTA_PROMOTOR");
    if (reply.sent) return;
    if (request.authUser?.role === "PROMOTER") {
      reply.code(403).send({ message: "Este perfil possui acesso somente aos books." });
    }
  });

  app.get("/api/modules/rota-promotor/meta", async () => ({ days: VALID_DAYS }));

  app.get("/api/modules/rota-promotor/entries", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const q = String(query.q || "").trim();
    const page = Math.max(1, Number(query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 30) || 30));
    try {
      return await listPromoterRoutes({ page, pageSize, query: q });
    } catch (error) {
      if (error instanceof OmegaApiError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }
      throw error;
    }
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
    if (action !== "CREATE" && !parsed.data.expectedUpdatedAt) {
      return reply.code(400).send({ message: "Versao do registro obrigatoria; atualize a lista e tente novamente." });
    }
    if (action === "UPDATE" && !parsed.data.data) {
      return reply.code(400).send({ message: "Dados da alteracao sao obrigatorios." });
    }

    const sourceId = action === "CREATE" ? randomUUID() : String(parsed.data.sourceId);
    const requestedData = parsed.data.data ? normalizeRouteData(parsed.data.data) : null;
    const created = await prisma.promoterRouteRequest.create({
      data: {
        action,
        status: "APPROVED",
        sourceId,
        requesterUserId: authUser.userId,
        reviewReason: "Aplicacao automatica pela API Omega.",
        reviewedAt: nowFortaleza(),
        requestedData: requestedData || undefined
      },
      include: { requesterUser: true, reviewerUser: true }
    });

    try {
      const result = await applyPromoterRouteChange(
        action === "CREATE"
          ? { action, sourceId, data: requestedData! }
          : action === "UPDATE"
            ? {
                action,
                sourceId,
                expectedUpdatedAt: parsed.data.expectedUpdatedAt!,
                data: requestedData!
              }
            : {
                action,
                sourceId,
                expectedUpdatedAt: parsed.data.expectedUpdatedAt!
              }
      );

      const applied = await prisma.$transaction(async (tx) => {
        const routeRequest = await tx.promoterRouteRequest.update({
          where: { id: created.id },
          data: {
            status: "APPLIED",
            currentData: result.previous || undefined,
            requestedData: result.entry || requestedData || undefined,
            appliedAt: nowFortaleza(),
            applyError: null
          },
          include: { requesterUser: true, reviewerUser: true }
        });

        await recordAudit(
          {
            actor: authUser,
            action: `APPLY_PROMOTER_ROUTE_${action}`,
            entityType: "PROMOTER_ROUTE_REQUEST",
            entityId: routeRequest.id,
            summary: `Alteracao de rota de promotor ${routeRequest.id} aplicada imediatamente pela API Omega (${action}).`,
            before: result.previous || undefined,
            after: result.entry || undefined
          },
          tx
        );
        return routeRequest;
      });

      return reply.code(201).send({ request: applied, entry: result.entry });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao aplicar a alteracao no Omega.";
      await prisma.$transaction(async (tx) => {
        const failed = await tx.promoterRouteRequest.update({
          where: { id: created.id },
          data: {
            status: "FAILED",
            applyError: message
          }
        });
        await recordAudit(
          {
            actor: authUser,
            action: `FAIL_PROMOTER_ROUTE_${action}`,
            entityType: "PROMOTER_ROUTE_REQUEST",
            entityId: failed.id,
            summary: `Alteracao de rota de promotor ${failed.id} nao foi aplicada (${action}).`,
            after: failed
          },
          tx
        );
      });
      if (error instanceof OmegaApiError) {
        return reply.code(error.statusCode).send({ message: error.message });
      }
      throw error;
    }
  });
}
