import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../lib/audit";
import { getUserModuleAccess, requireAuth, requireModuleAccess, requireRouteReviewer } from "../../lib/security";
import { nowFortaleza } from "../../lib/dates";
import { readRoutingWorkbook, VALID_DAYS, VALID_TYPES } from "../../lib/routingExcel";

const createRequestSchema = z.object({
  kind: z.enum(["INCLUSAO", "MODIFICACAO"]),
  items: z
    .array(
      z.object({
        action: z.enum(["ADD", "UPDATE"]),
        codusur: z.coerce.number().int().positive(),
        codcli: z.coerce.number().int().positive(),
        cliente: z.string().optional().default(""),
        requestedDia: z.enum(VALID_DAYS as [string, ...string[]]),
        requestedTipo: z.enum(VALID_TYPES as [string, ...string[]])
      })
    )
    .min(1)
});

const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().optional().default("")
});

function parseCsv(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function allowedSupervisorFilter(role: string, supervisorCodes: number[]) {
  if (role === "ADMIN" || role === "ANALYST") return {};
  return { codsup: { in: supervisorCodes } };
}

async function getRouteAccessOrThrow(userId: number) {
  const access = await getUserModuleAccess(userId, "ROUTEIRIZACAO");
  if (!access?.canAccess) throw new Error("Usuario sem acesso ao modulo.");
  return access;
}

function serializeRequest(request: any) {
  return {
    ...request,
    itemCount: request.items?.length || 0
  };
}

async function enrichItem(rawItem: z.infer<typeof createRequestSchema>["items"][number], action: "ADD" | "UPDATE") {
  const rca = await prisma.baseRca.findUnique({ where: { codusur: rawItem.codusur } });
  if (!rca) {
    throw new Error(`RCA ${rawItem.codusur} nao encontrado na base RCA.`);
  }

  const current = await prisma.routingEntry.findUnique({
    where: { codusur_codcli: { codusur: rawItem.codusur, codcli: rawItem.codcli } }
  });

  if (action === "ADD" && current) {
    throw new Error(`Cliente ${rawItem.codcli} ja esta na rota do RCA ${rawItem.codusur}.`);
  }

  if (action === "UPDATE" && !current) {
    throw new Error(`Cliente ${rawItem.codcli} nao esta na rota do RCA ${rawItem.codusur}.`);
  }

  return {
    action,
    codgerente: rca.codgerente,
    coordenador: rca.coordenador,
    codsup: rca.codsup,
    supervisor: rca.supervisor,
    codusur: rca.codusur,
    rca: rca.rca,
    codcli: rawItem.codcli,
    cliente: rawItem.cliente || current?.cliente || `Cliente ${rawItem.codcli}`,
    currentDia: current?.dia || null,
    currentTipo: current?.tipo || null,
    requestedDia: rawItem.requestedDia,
    requestedTipo: rawItem.requestedTipo
  };
}

export async function registerRoteirizacaoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/modules/roteirizacao")) return;
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireModuleAccess(request, reply, "ROUTEIRIZACAO");
  });

  app.get("/api/modules/roteirizacao/meta", async () => ({
    days: VALID_DAYS,
    types: VALID_TYPES
  }));

  app.get("/api/modules/roteirizacao/rcas", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);

    const rcas = await prisma.baseRca.findMany({
      where: allowedSupervisorFilter(authUser.role, access.supervisorCodes),
      orderBy: [{ supervisor: "asc" }, { rca: "asc" }]
    });

    return { rcas };
  });

  app.get("/api/modules/roteirizacao/vendors/:codusur/clients", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);
    const codusur = Number((request.params as { codusur: string }).codusur);

    const vendor = await prisma.baseRca.findUnique({ where: { codusur } });
    if (!vendor) return reply.code(404).send({ message: "RCA nao encontrado." });
    if (authUser.role === "SUPERVISOR" && !access.supervisorCodes.includes(vendor.codsup)) {
      return reply.code(403).send({ message: "RCA fora da base permitida." });
    }

    const clients = await prisma.routingEntry.findMany({
      where: { codusur },
      orderBy: [{ cliente: "asc" }, { codcli: "asc" }]
    });

    return { clients };
  });

  app.get("/api/modules/roteirizacao/entries", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);
    const query = request.query as Record<string, string | undefined>;
    const q = String(query.q || "").trim();
    const days = parseCsv(query.days);
    const types = parseCsv(query.types);
    const page = Math.max(1, Number(query.page || 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 30) || 30));
    const allowedVendors =
      authUser.role === "SUPERVISOR"
        ? await prisma.baseRca.findMany({
            where: { codsup: { in: access.supervisorCodes } },
            select: { codusur: true }
          })
        : [];
    const matchingBaseVendors = q
      ? await prisma.baseRca.findMany({
          where: {
            rca: { contains: q, mode: "insensitive" },
            ...(authUser.role === "SUPERVISOR" ? { codsup: { in: access.supervisorCodes } } : {})
          },
          select: { codusur: true }
        })
      : [];

    const where: any = {
      ...(authUser.role === "SUPERVISOR" ? { codusur: { in: allowedVendors.map((vendor) => vendor.codusur) } } : {}),
      ...(days.length ? { dia: { in: days } } : {}),
      ...(types.length ? { tipo: { in: types } } : {}),
      ...(q
        ? {
            OR: [
              ...(matchingBaseVendors.length
                ? [{ codusur: { in: matchingBaseVendors.map((vendor) => vendor.codusur) } }]
                : []),
              { cliente: { contains: q, mode: "insensitive" } },
              { codusur: Number.isInteger(Number(q)) ? Number(q) : -1 },
              { codcli: Number.isInteger(Number(q)) ? Number(q) : -1 }
            ]
          }
        : {})
    };

    const [total, entries] = await Promise.all([
      prisma.routingEntry.count({ where }),
      prisma.routingEntry.findMany({
        where,
        orderBy: [{ supervisor: "asc" }, { rca: "asc" }, { dia: "asc" }, { cliente: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    const baseRcas = await prisma.baseRca.findMany({
      where: { codusur: { in: Array.from(new Set(entries.map((entry) => entry.codusur))) } }
    });
    const baseByCodusur = new Map(baseRcas.map((rca) => [rca.codusur, rca]));

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      entries: entries.map((entry) => {
        const rca = baseByCodusur.get(entry.codusur);
        return rca
          ? {
              ...entry,
              codgerente: rca.codgerente,
              coordenador: rca.coordenador,
              codsup: rca.codsup,
              supervisor: rca.supervisor,
              rca: rca.rca
            }
          : entry;
      })
    };
  });

  app.get("/api/modules/roteirizacao/requests", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);
    const query = request.query as Record<string, string | undefined>;
    const status = query.status === "ALL" ? undefined : query.status || "PENDING";

    const requests = await prisma.routeRequest.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(authUser.role === "SUPERVISOR"
          ? {
              requesterUserId: authUser.userId,
              items: { some: { codsup: { in: access.supervisorCodes } } }
            }
          : {})
      },
      include: {
        requesterUser: true,
        reviewerUser: true,
        items: { orderBy: { id: "asc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return { requests: requests.map(serializeRequest) };
  });

  app.post("/api/modules/roteirizacao/requests", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);
    const parsed = createRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message || "Dados invalidos." });

    if (parsed.data.kind === "INCLUSAO" && parsed.data.items.some((item) => item.action !== "ADD")) {
      return reply.code(400).send({ message: "Solicitacao de inclusao aceita apenas itens de inclusao." });
    }

    if (parsed.data.kind === "MODIFICACAO" && parsed.data.items.some((item) => item.action !== "UPDATE")) {
      return reply.code(400).send({ message: "Solicitacao de modificacao aceita apenas itens de modificacao." });
    }

    try {
      const enrichedItems: Array<Awaited<ReturnType<typeof enrichItem>>> = [];
      for (const item of parsed.data.items) {
        const enriched = await enrichItem(item, item.action);
        if (authUser.role === "SUPERVISOR" && !access.supervisorCodes.includes(enriched.codsup)) {
          throw new Error(`RCA ${item.codusur} fora da base permitida.`);
        }
        enrichedItems.push(enriched);
      }

      const created = await prisma.$transaction(async (tx) => {
        const routeRequest = await tx.routeRequest.create({
          data: {
            kind: parsed.data.kind,
            requesterUserId: authUser.userId,
            items: { create: enrichedItems }
          },
          include: { requesterUser: true, reviewerUser: true, items: true }
        });

        await recordAudit(
          {
            actor: authUser,
            action: "CREATE_ROUTE_REQUEST",
            entityType: "ROUTE_REQUEST",
            entityId: routeRequest.id,
            summary: `Solicitacao de roteirizacao ${routeRequest.id} criada.`,
            after: routeRequest
          },
          tx
        );

        return routeRequest;
      });

      return reply.code(201).send({ request: serializeRequest(created) });
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Falha ao criar solicitacao." });
    }
  });

  app.post("/api/modules/roteirizacao/import-preview", async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const access = await getRouteAccessOrThrow(authUser.userId);
    const file = await request.file();
    if (!file) return reply.code(400).send({ message: "Planilha obrigatoria." });

    const tempPath = path.join(os.tmpdir(), `roteirizacao-${Date.now()}-${file.filename}`);
    await fs.writeFile(tempPath, await file.toBuffer());

    try {
      const rows = readRoutingWorkbook(tempPath);
      const preview = [];
      let unchanged = 0;
      for (const row of rows) {
        const rca = await prisma.baseRca.findUnique({ where: { codusur: row.codusur } });
        if (!rca) {
          return reply.code(400).send({ message: `RCA ${row.codusur} nao encontrado na base RCA.` });
        }

        if (authUser.role === "SUPERVISOR" && !access.supervisorCodes.includes(rca.codsup)) {
          return reply
            .code(403)
            .send({ message: `RCA ${row.codusur} bloqueia a importacao: vendedor pertence ao supervisor ${rca.codsup}, fora dos seus codigos permitidos.` });
        }

        const current = await prisma.routingEntry.findUnique({
          where: { codusur_codcli: { codusur: row.codusur, codcli: row.codcli } }
        });

        if (current && current.dia === row.dia && current.tipo === row.tipo) {
          unchanged += 1;
          continue;
        }

        preview.push({
          ...row,
          codgerente: rca.codgerente,
          coordenador: rca.coordenador,
          codsup: rca.codsup,
          supervisor: rca.supervisor,
          rca: rca.rca,
          action: current ? "UPDATE" : "ADD",
          currentDia: current?.dia || null,
          currentTipo: current?.tipo || null,
          currentCliente: current?.cliente || null
        });
      }
      return {
        rows: preview,
        summary: {
          total: preview.length,
          additions: preview.filter((row) => row.action === "ADD").length,
          updates: preview.filter((row) => row.action === "UPDATE").length,
          unchanged
        }
      };
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Falha ao ler planilha." });
    } finally {
      await fs.unlink(tempPath).catch(() => undefined);
    }
  });

  app.patch("/api/modules/roteirizacao/requests/:id/review", { preHandler: [requireRouteReviewer] }, async (request, reply) => {
    const authUser = request.authUser;
    if (!authUser) return reply.code(401).send({ message: "Usuario nao autenticado." });
    const requestId = Number((request.params as { id: string }).id);
    const parsed = reviewSchema.safeParse(request.body);
    if (!Number.isInteger(requestId) || requestId <= 0) return reply.code(400).send({ message: "Solicitacao invalida." });
    if (!parsed.success) return reply.code(400).send({ message: "Dados de revisao invalidos." });

    const current = await prisma.routeRequest.findUnique({ where: { id: requestId }, include: { items: true } });
    if (!current) return reply.code(404).send({ message: "Solicitacao nao encontrada." });
    if (current.status !== "PENDING") return reply.code(400).send({ message: "Solicitacao ja revisada." });

    const reviewed = await prisma.$transaction(async (tx) => {
      if (parsed.data.decision === "APPROVED") {
        for (const item of current.items) {
          if (item.action === "ADD") {
            await tx.routingEntry.create({
              data: {
                codgerente: item.codgerente,
                coordenador: item.coordenador,
                codsup: item.codsup,
                supervisor: item.supervisor,
                codusur: item.codusur,
                rca: item.rca,
                codcli: item.codcli,
                cliente: item.cliente || `Cliente ${item.codcli}`,
                dia: item.requestedDia,
                tipo: item.requestedTipo,
                dataAlteracao: nowFortaleza()
              }
            });
          } else {
            await tx.routingEntry.update({
              where: { codusur_codcli: { codusur: item.codusur, codcli: item.codcli } },
              data: {
                dia: item.requestedDia,
                tipo: item.requestedTipo,
                dataAlteracao: nowFortaleza()
              }
            });
          }
        }
      }

      const updated = await tx.routeRequest.update({
        where: { id: requestId },
        data: {
          status: parsed.data.decision,
          reviewerUserId: authUser.userId,
          reviewReason: parsed.data.reason || null,
          reviewedAt: nowFortaleza()
        },
        include: { requesterUser: true, reviewerUser: true, items: true }
      });

      await recordAudit(
        {
          actor: authUser,
          action: parsed.data.decision === "APPROVED" ? "APPROVE_ROUTE_REQUEST" : "REJECT_ROUTE_REQUEST",
          entityType: "ROUTE_REQUEST",
          entityId: requestId,
          summary: `Solicitacao de roteirizacao ${requestId} ${parsed.data.decision === "APPROVED" ? "aprovada" : "recusada"}.`,
          before: current,
          after: updated
        },
        tx
      );

      return updated;
    });

    return { request: serializeRequest(reviewed) };
  });
}
