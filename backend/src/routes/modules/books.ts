import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { recordAudit } from "../../lib/audit";
import { getOmegaCustomers, OmegaApiError } from "../../lib/omegaApi";
import prisma from "../../lib/prisma";
import { requireAuth, requireModuleAccess } from "../../lib/security";
import type { AppUserRole } from "../../types";

const PHOTO_TYPES = ["FRENTE_LOJA", "ACAO"] as const;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_TOTAL_UPLOAD_SIZE = 150 * 1024 * 1024;
const BOOK_MANAGER_ROLES = new Set<AppUserRole>(["ADMIN", "ANALYST", "MERCH_COORDINATOR"]);
const BOOK_REVIEWER_ROLES = new Set<AppUserRole>(["ADMIN", "SUPERVISOR"]);

const bookSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do book.").max(200),
  codigoFornecedor: z.coerce.number().int().positive("Informe um codigo de fornecedor valido."),
  mesAno: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o periodo no formato mes/ano."),
  capaMantidaId: z.coerce.number().int().positive().optional().nullable()
});

const submissionSchema = z.object({
  codigoCliente: z.coerce.number().int().positive("Informe um codigo de cliente valido.")
});

type PhotoType = (typeof PHOTO_TYPES)[number];
type UploadedImage = {
  type: PhotoType | "CAPA";
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  relativePath: string;
  absolutePath: string;
  url: string;
};

const monthNames = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function periodValues(monthValue: string) {
  const [yearText, monthText] = monthValue.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return { label: `${monthNames[month - 1]}/${year}`, firstDay: new Date(Date.UTC(year, month - 1, 1)) };
}

function publicOrigin(request: FastifyRequest): string {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "localhost").split(",")[0].trim();
  return `${request.protocol}://${forwardedHost}`;
}

function imageExtension(mimeType: string): string {
  return mimeType === "image/png" ? ".png" : ".jpg";
}

function validImageSignature(mimeType: string, signature: Buffer): boolean {
  if (mimeType === "image/png") {
    return signature.length >= 8 && signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
}

async function deleteFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((filePath) => fs.unlink(filePath).catch(() => undefined)));
}

async function saveImage(request: FastifyRequest, part: any, targetDir: string, folder: string, type: PhotoType | "CAPA") {
  if (!ALLOWED_MIME_TYPES.has(part.mimetype)) {
    part.file.resume();
    throw new Error("Envie somente imagens PNG ou JPEG/JPG.");
  }
  const fileName = `${randomUUID()}${imageExtension(part.mimetype)}`;
  const absolutePath = path.join(targetDir, fileName);
  let size = 0;
  let signature = Buffer.alloc(0);
  const inspector = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (signature.length < 12) signature = Buffer.concat([signature, chunk]).subarray(0, 12);
      callback(null, chunk);
    }
  });
  await pipeline(part.file, inspector, createWriteStream(absolutePath, { flags: "wx" }));
  if (part.file.truncated) throw new Error("Uma das imagens excede o limite de 25 MB.");
  if (!validImageSignature(part.mimetype, signature)) throw new Error("O conteudo de uma imagem nao corresponde ao formato informado.");
  const relativePath = path.posix.join("books", folder, fileName);
  return {
    type,
    originalName: path.basename(part.filename || fileName).slice(0, 255),
    fileName,
    mimeType: part.mimetype,
    size,
    relativePath,
    absolutePath,
    url: `${publicOrigin(request)}/anexos/${relativePath}`
  } satisfies UploadedImage;
}

async function parseMultipart<T>(request: FastifyRequest, schema: z.ZodType<T>, resolveType: (fieldName: string) => PhotoType | "CAPA" | null) {
  const folder = randomUUID();
  const targetDir = path.join(env.attachmentsDir, "books", folder);
  await fs.mkdir(targetDir, { recursive: true });
  let rawData = "";
  let totalSize = 0;
  const images: UploadedImage[] = [];
  try {
    for await (const part of request.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "dados") rawData = String(part.value || "");
        continue;
      }
      const type = resolveType(part.fieldname);
      if (!type) {
        part.file.resume();
        throw new Error("Campo de imagem invalido.");
      }
      const image = await saveImage(request, part, targetDir, folder, type);
      images.push(image);
      totalSize += image.size;
      if (totalSize > MAX_TOTAL_UPLOAD_SIZE) throw new Error("O conjunto de imagens excede o limite de 150 MB.");
    }
    let parsedJson: unknown;
    try { parsedJson = JSON.parse(rawData); } catch { throw new Error("Dados enviados invalidos."); }
    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Dados enviados invalidos.");
    return { data: parsed.data, images, targetDir };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

const bookInclude = {
  criadoPor: { select: { id: true, displayName: true } },
  atualizadoPor: { select: { id: true, displayName: true } },
  workflow: { include: { encerradoPor: { select: { id: true, displayName: true } }, revisadoPor: { select: { id: true, displayName: true } } } },
  anexos: { orderBy: { criadoEm: "asc" as const } },
  registros: { orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }], include: { anexos: { orderBy: { criadoEm: "asc" as const } } } }
};

function isManager(role: AppUserRole): boolean { return BOOK_MANAGER_ROLES.has(role); }
function isReviewer(role: AppUserRole): boolean { return BOOK_REVIEWER_ROLES.has(role); }

function requireBookManager(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!request.authUser || !isManager(request.authUser.role)) {
    reply.code(403).send({ message: "Apenas o coordenador de merchandising pode gerenciar books." });
    return false;
  }
  return true;
}

function effectiveStatus(workflow: { status: string } | null | undefined): string {
  return workflow?.status || "ACTIVE";
}

export async function registerBookRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/modules/promotores/books")) return;
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireModuleAccess(request, reply, "ROTA_PROMOTOR");
  });

  app.get("/api/modules/promotores/books", async (request) => {
    const authUser = request.authUser!;
    const query = request.query as Record<string, string | undefined>;
    const q = String(query.q || "").trim();
    const page = Math.max(1, Number(query.page || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20) || 20));
    const numericQuery = Number(q);
    const searchWhere = q
      ? { OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { codigoFornecedor: Number.isInteger(numericQuery) ? numericQuery : -1 }, { periodo: { contains: q, mode: "insensitive" as const } }] }
      : {};
    const where = authUser.role === "PROMOTER"
      ? { AND: [searchWhere, { OR: [{ workflow: { is: null } }, { workflow: { is: { status: "ACTIVE" as const } } }] }] }
      : searchWhere;
    const [total, books] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          workflow: true,
          criadoPor: { select: { id: true, displayName: true } },
          anexos: { where: { tipo: "CAPA" }, take: 1, orderBy: { criadoEm: "desc" } },
          _count: {
            select: authUser.role === "PROMOTER"
              ? { envios: { where: { promotorUserId: authUser.userId } } }
              : { registros: true, anexos: true, envios: true }
          }
        }
      })
    ]);
    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), books: books.map((book) => ({ ...book, status: effectiveStatus(book.workflow) })) };
  });

  app.get("/api/modules/promotores/books/clientes/:codigo", async (request, reply) => {
    const codigo = Number((request.params as { codigo: string }).codigo);
    if (!Number.isInteger(codigo) || codigo <= 0) return reply.code(400).send({ message: "Informe um codigo de cliente valido." });
    try {
      const [cliente] = await getOmegaCustomers([codigo]);
      if (!cliente) return reply.code(404).send({ message: "Cliente nao encontrado no Winthor." });
      return { cliente };
    } catch (error) {
      if (error instanceof OmegaApiError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  app.get("/api/modules/promotores/books/:id", async (request, reply) => {
    const authUser = request.authUser!;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const ownAcceptedRecordIds = authUser.role === "PROMOTER"
      ? (await prisma.bookSubmission.findMany({
          where: {
            bookId: id,
            promotorUserId: authUser.userId,
            status: "ACCEPTED",
            registroBookId: { not: null }
          },
          select: { registroBookId: true }
        })).flatMap((submission) => submission.registroBookId === null ? [] : [submission.registroBookId])
      : null;
    const book = await prisma.book.findUnique({
      where: { id },
      include: {
        ...bookInclude,
        registros: {
          ...(ownAcceptedRecordIds ? { where: { id: { in: ownAcceptedRecordIds } } } : {}),
          orderBy: [{ ordem: "asc" }, { id: "asc" }],
          include: { anexos: { orderBy: { criadoEm: "asc" } } }
        },
        envios: {
          where: authUser.role === "PROMOTER" ? { promotorUserId: authUser.userId } : undefined,
          orderBy: { criadoEm: "desc" },
          include: { anexos: { orderBy: { criadoEm: "asc" } }, promotorUser: { select: { id: true, displayName: true } }, revisorUser: { select: { id: true, displayName: true } } }
        }
      }
    });
    if (!book) return reply.code(404).send({ message: "Book nao encontrado." });
    const status = effectiveStatus(book.workflow);
    if (authUser.role === "PROMOTER" && status !== "ACTIVE") return reply.code(403).send({ message: "Este book nao esta mais ativo." });
    const customerCodes = [...book.registros.map((record) => record.codigoCliente), ...book.envios.map((submission) => submission.codigoCliente)];
    try {
      const customers = await getOmegaCustomers(customerCodes);
      const customersByCode = new Map(customers.map((customer) => [customer.codigo, customer]));
      return {
        book: {
          ...book,
          status,
          registros: book.registros.map((record) => ({
            ...record,
            clienteNome: customersByCode.get(record.codigoCliente)?.nome || "Cliente nao encontrado",
            clienteCidade: customersByCode.get(record.codigoCliente)?.cidade || "Cidade nao informada"
          })),
          envios: book.envios.map((submission) => ({
            ...submission,
            clienteNome: customersByCode.get(submission.codigoCliente)?.nome || "Cliente nao encontrado",
            clienteCidade: customersByCode.get(submission.codigoCliente)?.cidade || "Cidade nao informada"
          }))
        }
      };
    } catch (error) {
      if (error instanceof OmegaApiError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });

  app.post("/api/modules/promotores/books", async (request, reply) => {
    if (!requireBookManager(request, reply)) return;
    const authUser = request.authUser!;
    let upload: Awaited<ReturnType<typeof parseMultipart<z.infer<typeof bookSchema>>>> | undefined;
    try {
      upload = await parseMultipart(request, bookSchema, (field) => field === "capa" ? "CAPA" : null);
      if (upload.images.length !== 1) throw new Error("Envie exatamente uma imagem de capa.");
    } catch (error) {
      if (upload) await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Nao foi possivel ler o book." });
    }
    try {
      const period = periodValues(upload.data.mesAno);
      const created = await prisma.$transaction(async (tx) => {
        const book = await tx.book.create({ data: { nome: upload!.data.nome, codigoFornecedor: upload!.data.codigoFornecedor, periodo: period.label, dataPeriodo: period.firstDay, criadoPorId: authUser.userId, atualizadoPorId: authUser.userId } });
        await tx.bookWorkflow.create({ data: { bookId: book.id, status: "ACTIVE" } });
        const cover = upload!.images[0];
        await tx.anexoBook.create({ data: { bookId: book.id, tipo: "CAPA", nomeOriginal: cover.originalName, nomeArquivo: cover.fileName, mimeType: cover.mimeType, tamanhoBytes: cover.size, caminho: cover.relativePath, url: cover.url } });
        await recordAudit({ actor: authUser, action: "CREATE_BOOK", entityType: "BOOK", entityId: book.id, summary: `Book ${book.id} criado: ${book.nome}.`, after: { nome: book.nome, codigoFornecedor: book.codigoFornecedor, periodo: book.periodo, status: "ACTIVE" } }, tx);
        return tx.book.findUniqueOrThrow({ where: { id: book.id }, include: bookInclude });
      });
      return reply.code(201).send({ book: { ...created, status: "ACTIVE", envios: [] } });
    } catch (error) {
      await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });

  app.put("/api/modules/promotores/books/:id", async (request, reply) => {
    if (!requireBookManager(request, reply)) return;
    const authUser = request.authUser!;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const existing = await prisma.book.findUnique({ where: { id }, include: { anexos: true, workflow: true } });
    if (!existing) return reply.code(404).send({ message: "Book nao encontrado." });
    if (effectiveStatus(existing.workflow) !== "ACTIVE") return reply.code(409).send({ message: "Reabra o book antes de editar seus dados." });
    let upload: Awaited<ReturnType<typeof parseMultipart<z.infer<typeof bookSchema>>>> | undefined;
    try {
      upload = await parseMultipart(request, bookSchema, (field) => field === "capa" ? "CAPA" : null);
      const oldCover = existing.anexos.find((item) => item.tipo === "CAPA");
      if (upload.images.length > 1) throw new Error("Envie somente uma imagem de capa.");
      if (!upload.images.length && upload.data.capaMantidaId !== oldCover?.id) throw new Error("Mantenha a capa atual ou envie uma nova capa.");
    } catch (error) {
      if (upload) await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Nao foi possivel ler o book." });
    }
    const oldCover = existing.anexos.find((item) => item.tipo === "CAPA");
    const period = periodValues(upload.data.mesAno);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.book.update({ where: { id }, data: { nome: upload!.data.nome, codigoFornecedor: upload!.data.codigoFornecedor, periodo: period.label, dataPeriodo: period.firstDay, atualizadoPorId: authUser.userId } });
      if (upload!.images.length) {
        await tx.anexoBook.deleteMany({ where: { bookId: id, tipo: "CAPA" } });
        const cover = upload!.images[0];
        await tx.anexoBook.create({ data: { bookId: id, tipo: "CAPA", nomeOriginal: cover.originalName, nomeArquivo: cover.fileName, mimeType: cover.mimeType, tamanhoBytes: cover.size, caminho: cover.relativePath, url: cover.url } });
      }
      await recordAudit({ actor: authUser, action: "UPDATE_BOOK", entityType: "BOOK", entityId: id, summary: `Book ${id} atualizado: ${upload!.data.nome}.`, before: { nome: existing.nome, codigoFornecedor: existing.codigoFornecedor, periodo: existing.periodo }, after: { nome: upload!.data.nome, codigoFornecedor: upload!.data.codigoFornecedor, periodo: period.label } }, tx);
      return tx.book.findUniqueOrThrow({ where: { id }, include: bookInclude });
    });
    if (upload.images.length && oldCover) await deleteFiles([path.join(env.attachmentsDir, oldCover.caminho)]);
    return { book: { ...updated, status: effectiveStatus(updated.workflow), envios: [] } };
  });

  app.post("/api/modules/promotores/books/:id/envios", async (request, reply) => {
    const authUser = request.authUser!;
    const managerSubmission = isManager(authUser.role);
    if (authUser.role !== "PROMOTER" && !managerSubmission) return reply.code(403).send({ message: "Este perfil nao pode adicionar registros." });
    const bookId = Number((request.params as { id: string }).id);
    const book = await prisma.book.findUnique({ where: { id: bookId }, include: { workflow: true } });
    if (!book) return reply.code(404).send({ message: "Book nao encontrado." });
    if (effectiveStatus(book.workflow) !== "ACTIVE") return reply.code(409).send({ message: "Este book foi encerrado e nao recebe novos registros." });
    let upload: Awaited<ReturnType<typeof parseMultipart<z.infer<typeof submissionSchema>>>> | undefined;
    try {
      upload = await parseMultipart(request, submissionSchema, (field) => {
        const match = /^foto:(FRENTE_LOJA|ACAO)$/.exec(field);
        return match ? match[1] as PhotoType : null;
      });
      if (!upload.images.length) throw new Error("Adicione pelo menos uma foto ao registro.");
    } catch (error) {
      if (upload) await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Nao foi possivel ler o registro." });
    }
    try {
      const [customer] = await getOmegaCustomers([upload.data.codigoCliente]);
      if (!customer) {
        await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
        return reply.code(400).send({ message: "Cliente nao encontrado no Winthor." });
      }
    } catch (error) {
      await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof OmegaApiError) return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: authUser.userId } });
    let submission;
    try {
      submission = await prisma.$transaction(async (tx) => {
        const workflow = await tx.bookWorkflow.findUnique({ where: { bookId } });
        if (effectiveStatus(workflow) !== "ACTIVE") throw new Error("Este book foi encerrado e nao recebe novos registros.");
        let recordId: number | null = null;
        if (managerSubmission) {
          const maximum = await tx.registroBook.aggregate({ where: { bookId }, _max: { ordem: true } });
          const record = await tx.registroBook.create({ data: { bookId, promotor: user.displayName, codigoCliente: upload!.data.codigoCliente, ordem: (maximum._max.ordem ?? -1) + 1 } });
          recordId = record.id;
        }
        const created = await tx.bookSubmission.create({
          data: {
            bookId,
            promotorUserId: user.id,
            promotorNome: user.displayName,
            codigoCliente: upload!.data.codigoCliente,
            ...(managerSubmission ? { status: "ACCEPTED", revisorUserId: user.id, revisadoEm: new Date(), registroBookId: recordId } : {})
          }
        });
        await tx.bookSubmissionAttachment.createMany({ data: upload!.images.map((image) => ({ envioId: created.id, tipo: image.type, nomeOriginal: image.originalName, nomeArquivo: image.fileName, mimeType: image.mimeType, tamanhoBytes: image.size, caminho: image.relativePath, url: image.url })) });
        if (recordId) {
          await tx.anexoBook.createMany({ data: upload!.images.map((image) => ({ bookId, registroId: recordId, tipo: image.type, nomeOriginal: image.originalName, nomeArquivo: image.fileName, mimeType: image.mimeType, tamanhoBytes: image.size, caminho: image.relativePath, url: image.url })) });
        }
        await recordAudit({ actor: authUser, action: managerSubmission ? "AUTO_ACCEPT_BOOK_RECORD" : "SUBMIT_BOOK_RECORD", entityType: "BOOK_SUBMISSION", entityId: created.id, summary: `${user.displayName} adicionou um registro ao book ${bookId}${managerSubmission ? " com aceite automatico" : ""}.`, after: { bookId, codigoCliente: created.codigoCliente, fotos: upload!.images.length, status: managerSubmission ? "ACCEPTED" : "PENDING", registroBookId: recordId } }, tx);
        return tx.bookSubmission.findUniqueOrThrow({ where: { id: created.id }, include: { anexos: true } });
      });
    } catch (error) {
      await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      if (error instanceof Error && error.message.includes("encerrado")) return reply.code(409).send({ message: error.message });
      throw error;
    }
    return reply.code(201).send({ submission });
  });

  app.patch("/api/modules/promotores/books/:bookId/envios/:submissionId/revisao", async (request, reply) => {
    if (!request.authUser || !isManager(request.authUser.role)) return reply.code(403).send({ message: "Apenas o coordenador pode revisar registros." });
    const authUser = request.authUser;
    const bookId = Number((request.params as { bookId: string }).bookId);
    const submissionId = Number((request.params as { submissionId: string }).submissionId);
    const parsed = z.object({ decisao: z.enum(["ACCEPTED", "REJECTED"]), motivo: z.string().trim().max(500).optional(), anexoIds: z.array(z.coerce.number().int().positive()).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Revisao invalida." });
    const submission = await prisma.bookSubmission.findUnique({ where: { id: submissionId }, include: { anexos: true, book: { include: { workflow: true } } } });
    if (!submission || submission.bookId !== bookId) return reply.code(404).send({ message: "Envio nao encontrado." });
    if (submission.status !== "PENDING") return reply.code(409).send({ message: "Este envio ja foi revisado." });
    if (effectiveStatus(submission.book.workflow) !== "ACTIVE") return reply.code(409).send({ message: "Reabra o book antes de revisar envios." });
    const selectedAttachmentIds = parsed.data.decisao === "ACCEPTED"
      ? [...new Set(parsed.data.anexoIds ?? submission.anexos.map((attachment) => attachment.id))]
      : [];
    const submissionAttachmentIds = new Set(submission.anexos.map((attachment) => attachment.id));
    if (parsed.data.decisao === "ACCEPTED" && (!selectedAttachmentIds.length || selectedAttachmentIds.some((id) => !submissionAttachmentIds.has(id)))) {
      return reply.code(400).send({ message: "Selecione pelo menos uma foto valida para aceitar o registro." });
    }
    const selectedAttachments = submission.anexos.filter((attachment) => selectedAttachmentIds.includes(attachment.id));
    const discardedAttachments = submission.anexos.filter((attachment) => !selectedAttachmentIds.includes(attachment.id));
    let recordId: number | null = null;
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.bookSubmission.updateMany({
        where: { id: submissionId, status: "PENDING" },
        data: { status: parsed.data.decisao, revisorUserId: authUser.userId, motivoRevisao: parsed.data.motivo || null, revisadoEm: new Date() }
      });
      if (claimed.count !== 1) throw new Error("Este envio ja foi revisado.");
      if (parsed.data.decisao === "ACCEPTED") {
        const maximum = await tx.registroBook.aggregate({ where: { bookId }, _max: { ordem: true } });
        const record = await tx.registroBook.create({ data: { bookId, promotor: submission.promotorNome, codigoCliente: submission.codigoCliente, ordem: (maximum._max.ordem ?? -1) + 1 } });
        recordId = record.id;
        await tx.anexoBook.createMany({ data: selectedAttachments.map((image) => ({ bookId, registroId: record.id, tipo: image.tipo, nomeOriginal: image.nomeOriginal, nomeArquivo: image.nomeArquivo, mimeType: image.mimeType, tamanhoBytes: image.tamanhoBytes, caminho: image.caminho, url: image.url })) });
        if (discardedAttachments.length) await tx.bookSubmissionAttachment.deleteMany({ where: { id: { in: discardedAttachments.map((attachment) => attachment.id) } } });
      } else {
        await tx.bookSubmissionAttachment.deleteMany({ where: { envioId: submissionId } });
      }
      if (recordId) await tx.bookSubmission.update({ where: { id: submissionId }, data: { registroBookId: recordId } });
      await recordAudit({ actor: authUser, action: parsed.data.decisao === "ACCEPTED" ? "ACCEPT_BOOK_RECORD" : "REJECT_BOOK_RECORD", entityType: "BOOK_SUBMISSION", entityId: submissionId, summary: `Envio ${submissionId} ${parsed.data.decisao === "ACCEPTED" ? "aceito" : "recusado"} no book ${bookId}.`, after: { status: parsed.data.decisao, registroBookId: recordId, motivo: parsed.data.motivo || null, fotosAceitas: selectedAttachments.length, fotosDescartadas: discardedAttachments.length } }, tx);
    });
    if (discardedAttachments.length) await deleteFiles(discardedAttachments.map((image) => path.join(env.attachmentsDir, image.caminho)));
    return { ok: true, registroBookId: recordId };
  });

  app.patch("/api/modules/promotores/books/:id/registros/ordem", async (request, reply) => {
    if (!requireBookManager(request, reply)) return;
    const bookId = Number((request.params as { id: string }).id);
    const parsed = z.object({ registroIds: z.array(z.coerce.number().int().positive()) }).safeParse(request.body);
    if (!parsed.success || new Set(parsed.data.registroIds).size !== parsed.data.registroIds.length) return reply.code(400).send({ message: "Ordem de registros invalida." });
    const records = await prisma.registroBook.findMany({ where: { bookId }, select: { id: true } });
    const currentIds = records.map((item) => item.id).sort((a, b) => a - b);
    const requestedIds = [...parsed.data.registroIds].sort((a, b) => a - b);
    if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) return reply.code(400).send({ message: "A ordem deve conter todos os registros do book." });
    await prisma.$transaction(parsed.data.registroIds.map((id, ordem) => prisma.registroBook.update({ where: { id }, data: { ordem } })));
    await recordAudit({ actor: request.authUser, action: "REORDER_BOOK_RECORDS", entityType: "BOOK", entityId: bookId, summary: `Registros do book ${bookId} reordenados.`, after: { registroIds: parsed.data.registroIds } });
    return { ok: true };
  });

  app.patch("/api/modules/promotores/books/:id/status", async (request, reply) => {
    const authUser = request.authUser!;
    const bookId = Number((request.params as { id: string }).id);
    const parsed = z.object({ status: z.enum(["ACTIVE", "CLOSED", "APPROVED", "REJECTED"]), motivo: z.string().trim().max(500).optional() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "Status invalido." });
    const book = await prisma.book.findUnique({ where: { id: bookId }, include: { workflow: true, _count: { select: { registros: true } } } });
    if (!book) return reply.code(404).send({ message: "Book nao encontrado." });
    const currentStatus = effectiveStatus(book.workflow);
    const managerChange = parsed.data.status === "ACTIVE" || parsed.data.status === "CLOSED";
    if (managerChange && !isManager(authUser.role)) return reply.code(403).send({ message: "Apenas o coordenador pode abrir ou encerrar books." });
    if (!managerChange && !isReviewer(authUser.role)) return reply.code(403).send({ message: "Apenas o supervisor pode aprovar ou recusar books." });
    if (parsed.data.status === "CLOSED") {
      const pending = await prisma.bookSubmission.count({ where: { bookId, status: "PENDING" } });
      if (pending) return reply.code(409).send({ message: "Revise todos os envios pendentes antes de encerrar o book." });
      if (!book._count.registros) return reply.code(409).send({ message: "O book precisa ter pelo menos um registro aceito antes de ser encerrado." });
    }
    if ((parsed.data.status === "APPROVED" || parsed.data.status === "REJECTED") && currentStatus !== "CLOSED") return reply.code(409).send({ message: "Somente books encerrados podem ser aprovados ou recusados." });
    const now = new Date();
    await prisma.bookWorkflow.upsert({
      where: { bookId },
      create: { bookId, status: parsed.data.status, encerradoPorId: parsed.data.status === "CLOSED" ? authUser.userId : null, encerradoEm: parsed.data.status === "CLOSED" ? now : null, revisadoPorId: !managerChange ? authUser.userId : null, revisadoEm: !managerChange ? now : null, motivoRevisao: parsed.data.motivo || null },
      update: { status: parsed.data.status, ...(parsed.data.status === "ACTIVE" ? { encerradoPorId: null, encerradoEm: null, revisadoPorId: null, revisadoEm: null, motivoRevisao: null } : {}), ...(parsed.data.status === "CLOSED" ? { encerradoPorId: authUser.userId, encerradoEm: now, revisadoPorId: null, revisadoEm: null, motivoRevisao: null } : {}), ...(!managerChange ? { revisadoPorId: authUser.userId, revisadoEm: now, motivoRevisao: parsed.data.motivo || null } : {}) }
    });
    await recordAudit({ actor: authUser, action: `BOOK_${parsed.data.status}`, entityType: "BOOK", entityId: bookId, summary: `Book ${bookId} alterado de ${currentStatus} para ${parsed.data.status}.`, before: { status: currentStatus }, after: { status: parsed.data.status, motivo: parsed.data.motivo || null } });
    return { ok: true, status: parsed.data.status };
  });

  app.delete("/api/modules/promotores/books/:id", async (request, reply) => {
    if (!requireBookManager(request, reply)) return;
    const authUser = request.authUser!;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const existing = await prisma.book.findUnique({ where: { id }, include: { anexos: true, envios: { include: { anexos: true } } } });
    if (!existing) return reply.code(404).send({ message: "Book nao encontrado." });
    await prisma.$transaction(async (tx) => {
      await tx.book.delete({ where: { id } });
      await recordAudit({ actor: authUser, action: "DELETE_BOOK", entityType: "BOOK", entityId: id, summary: `Book ${id} excluido: ${existing.nome}.`, before: { nome: existing.nome, codigoFornecedor: existing.codigoFornecedor, periodo: existing.periodo } }, tx);
    });
    const paths = new Set([...existing.anexos.map((item) => item.caminho), ...existing.envios.flatMap((item) => item.anexos.map((attachment) => attachment.caminho))]);
    await deleteFiles([...paths].map((item) => path.join(env.attachmentsDir, item)));
    return reply.code(204).send();
  });
}
