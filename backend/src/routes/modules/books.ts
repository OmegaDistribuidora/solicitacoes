import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config";
import { recordAudit } from "../../lib/audit";
import prisma from "../../lib/prisma";
import { requireAuth, requireModuleAccess } from "../../lib/security";

const PHOTO_TYPES = ["FRENTE_LOJA", "ACAO"] as const;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_TOTAL_UPLOAD_SIZE = 150 * 1024 * 1024;

const recordSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  promotor: z.string().trim().min(1, "Informe o promotor.").max(200),
  codigoCliente: z.coerce.number().int().positive("Informe um codigo de cliente valido."),
  anexosMantidos: z.array(z.coerce.number().int().positive()).default([])
});

const bookSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome do book.").max(200),
  codigoFornecedor: z.coerce.number().int().positive("Informe um codigo de fornecedor valido."),
  mesAno: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Informe o periodo no formato mes/ano."),
  capaMantidaId: z.coerce.number().int().positive().optional().nullable(),
  registros: z.array(recordSchema).min(1, "Adicione pelo menos um registro.").max(100)
});

type PhotoType = (typeof PHOTO_TYPES)[number];
type UploadedImage = {
  recordIndex: number | null;
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
  return {
    label: `${monthNames[month - 1]}/${year}`,
    firstDay: new Date(Date.UTC(year, month - 1, 1))
  };
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

async function parseBookMultipart(request: FastifyRequest) {
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

      if (!ALLOWED_MIME_TYPES.has(part.mimetype)) {
        part.file.resume();
        throw new Error("Envie somente imagens PNG ou JPEG/JPG.");
      }

      let type: PhotoType | "CAPA";
      let recordIndex: number | null;
      if (part.fieldname === "capa") {
        type = "CAPA";
        recordIndex = null;
      } else {
        const match = /^foto:(\d+):(FRENTE_LOJA|ACAO)$/.exec(part.fieldname);
        if (!match) {
          part.file.resume();
          throw new Error("Campo de imagem invalido.");
        }
        recordIndex = Number(match[1]);
        type = match[2] as PhotoType;
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
      totalSize += size;
      if (totalSize > MAX_TOTAL_UPLOAD_SIZE) throw new Error("O conjunto de imagens excede o limite de 150 MB.");

      const relativePath = path.posix.join("books", folder, fileName);
      images.push({
        recordIndex,
        type,
        originalName: path.basename(part.filename || fileName).slice(0, 255),
        fileName,
        mimeType: part.mimetype,
        size,
        relativePath,
        absolutePath,
        url: `${publicOrigin(request)}/anexos/${relativePath}`
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawData);
    } catch {
      throw new Error("Dados do book invalidos.");
    }
    const parsed = bookSchema.safeParse(parsedJson);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Dados do book invalidos.");
    if (images.some((image) => image.recordIndex != null && image.recordIndex >= parsed.data.registros.length)) {
      throw new Error("Uma imagem esta associada a um registro inexistente.");
    }
    return { data: parsed.data, images, targetDir };
  } catch (error) {
    await fs.rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

const bookInclude = {
  criadoPor: { select: { id: true, displayName: true } },
  atualizadoPor: { select: { id: true, displayName: true } },
  anexos: { orderBy: { criadoEm: "asc" as const } },
  registros: { orderBy: [{ ordem: "asc" as const }, { id: "asc" as const }], include: { anexos: { orderBy: { criadoEm: "asc" as const } } } }
};

function validateCreateImages(registros: Array<unknown>, images: UploadedImage[]): void {
  if (images.filter((image) => image.type === "CAPA").length !== 1) throw new Error("Envie exatamente uma imagem de capa.");
  registros.forEach((_record, index) => {
    if (!images.some((image) => image.recordIndex === index)) throw new Error(`Adicione pelo menos uma foto ao registro ${index + 1}.`);
  });
}

export async function registerBookRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/modules/promotores/books")) return;
    await requireAuth(request, reply);
    if (reply.sent) return;
    await requireModuleAccess(request, reply, "ROTA_PROMOTOR");
  });

  app.get("/api/modules/promotores/books", async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const q = String(query.q || "").trim();
    const page = Math.max(1, Number(query.page || 1) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(query.pageSize || 20) || 20));
    const numericQuery = Number(q);
    const where = q
      ? { OR: [{ nome: { contains: q, mode: "insensitive" as const } }, { codigoFornecedor: Number.isInteger(numericQuery) ? numericQuery : -1 }, { periodo: { contains: q, mode: "insensitive" as const } }] }
      : {};
    const [total, books] = await Promise.all([
      prisma.book.count({ where }),
      prisma.book.findMany({
        where,
        orderBy: { criadoEm: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          criadoPor: { select: { id: true, displayName: true } },
          anexos: { where: { tipo: "CAPA" }, take: 1, orderBy: { criadoEm: "desc" } },
          _count: { select: { registros: true, anexos: true } }
        }
      })
    ]);
    return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), books };
  });

  app.get("/api/modules/promotores/books/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const book = await prisma.book.findUnique({ where: { id }, include: bookInclude });
    if (!book) return reply.code(404).send({ message: "Book nao encontrado." });
    return { book };
  });

  app.post("/api/modules/promotores/books", async (request, reply) => {
    const authUser = request.authUser!;
    let upload: Awaited<ReturnType<typeof parseBookMultipart>> | undefined;
    try {
      upload = await parseBookMultipart(request);
      validateCreateImages(upload.data.registros, upload.images);
    } catch (error) {
      if (upload) await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Nao foi possivel ler o book." });
    }

    try {
      const period = periodValues(upload.data.mesAno);
      const created = await prisma.$transaction(async (tx) => {
        const book = await tx.book.create({
          data: {
            nome: upload.data.nome,
            codigoFornecedor: upload.data.codigoFornecedor,
            periodo: period.label,
            dataPeriodo: period.firstDay,
            criadoPorId: authUser.userId,
            atualizadoPorId: authUser.userId
          }
        });
        const recordIds: number[] = [];
        for (const [index, record] of upload.data.registros.entries()) {
          const createdRecord = await tx.registroBook.create({ data: { bookId: book.id, promotor: record.promotor, codigoCliente: record.codigoCliente, ordem: index } });
          recordIds.push(createdRecord.id);
        }
        await tx.anexoBook.createMany({
          data: upload.images.map((image) => ({
            bookId: book.id,
            registroId: image.recordIndex == null ? null : recordIds[image.recordIndex],
            tipo: image.type,
            nomeOriginal: image.originalName,
            nomeArquivo: image.fileName,
            mimeType: image.mimeType,
            tamanhoBytes: image.size,
            caminho: image.relativePath,
            url: image.url
          }))
        });
        await recordAudit({ actor: authUser, action: "CREATE_BOOK", entityType: "BOOK", entityId: book.id, summary: `Book ${book.id} criado: ${book.nome}.`, after: { nome: book.nome, codigoFornecedor: book.codigoFornecedor, periodo: book.periodo, registros: recordIds.length, anexos: upload.images.length } }, tx);
        return tx.book.findUniqueOrThrow({ where: { id: book.id }, include: bookInclude });
      });
      return reply.code(201).send({ book: created });
    } catch (error) {
      await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });

  app.put("/api/modules/promotores/books/:id", async (request, reply) => {
    const authUser = request.authUser!;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const existing = await prisma.book.findUnique({ where: { id }, include: { registros: { include: { anexos: true } }, anexos: true } });
    if (!existing) return reply.code(404).send({ message: "Book nao encontrado." });

    let upload: Awaited<ReturnType<typeof parseBookMultipart>> | undefined;
    try {
      upload = await parseBookMultipart(request);
      const existingRecordMap = new Map(existing.registros.map((record) => [record.id, record]));
      const usedRecordIds = new Set<number>();
      for (const [index, record] of upload.data.registros.entries()) {
        if (record.id) {
          const current = existingRecordMap.get(record.id);
          if (!current || usedRecordIds.has(record.id)) throw new Error("Um dos registros informados nao pertence a este book.");
          usedRecordIds.add(record.id);
          const validIds = new Set(current.anexos.map((attachment) => attachment.id));
          if (record.anexosMantidos.some((attachmentId) => !validIds.has(attachmentId))) throw new Error(`Anexo invalido no registro ${index + 1}.`);
        } else if (record.anexosMantidos.length) {
          throw new Error("Um novo registro nao pode reutilizar anexos antigos.");
        }
        const newPhotos = upload.images.filter((image) => image.recordIndex === index).length;
        if (record.anexosMantidos.length + newPhotos === 0) throw new Error(`Adicione pelo menos uma foto ao registro ${index + 1}.`);
      }
      const oldCover = existing.anexos.find((attachment) => attachment.tipo === "CAPA");
      const newCovers = upload.images.filter((image) => image.type === "CAPA");
      if (newCovers.length > 1) throw new Error("Envie somente uma imagem de capa.");
      if (!newCovers.length && (!upload.data.capaMantidaId || upload.data.capaMantidaId !== oldCover?.id)) throw new Error("Mantenha a capa atual ou envie uma nova capa.");
    } catch (error) {
      if (upload) await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Nao foi possivel ler o book." });
    }

    const keepAttachmentIds = new Set(upload.data.registros.flatMap((record) => record.anexosMantidos));
    if (!upload.images.some((image) => image.type === "CAPA") && upload.data.capaMantidaId) keepAttachmentIds.add(upload.data.capaMantidaId);
    const removedFiles = existing.anexos.filter((attachment) => !keepAttachmentIds.has(attachment.id)).map((attachment) => path.join(env.attachmentsDir, attachment.caminho));

    try {
      const period = periodValues(upload.data.mesAno);
      const updated = await prisma.$transaction(async (tx) => {
        await tx.book.update({ where: { id }, data: { nome: upload.data.nome, codigoFornecedor: upload.data.codigoFornecedor, periodo: period.label, dataPeriodo: period.firstDay, atualizadoPorId: authUser.userId } });
        const retainedRecordIds = upload.data.registros.flatMap((record) => (record.id ? [record.id] : []));
        await tx.registroBook.deleteMany({ where: { bookId: id, id: { notIn: retainedRecordIds } } });
        const recordIds: number[] = [];
        for (const [index, record] of upload.data.registros.entries()) {
          if (record.id) {
            await tx.registroBook.update({ where: { id: record.id }, data: { promotor: record.promotor, codigoCliente: record.codigoCliente, ordem: index } });
            await tx.anexoBook.deleteMany({ where: { registroId: record.id, id: { notIn: record.anexosMantidos } } });
            recordIds.push(record.id);
          } else {
            const createdRecord = await tx.registroBook.create({ data: { bookId: id, promotor: record.promotor, codigoCliente: record.codigoCliente, ordem: index } });
            recordIds.push(createdRecord.id);
          }
        }
        if (upload.images.some((image) => image.type === "CAPA")) await tx.anexoBook.deleteMany({ where: { bookId: id, tipo: "CAPA" } });
        if (upload.images.length) {
          await tx.anexoBook.createMany({
            data: upload.images.map((image) => ({ bookId: id, registroId: image.recordIndex == null ? null : recordIds[image.recordIndex], tipo: image.type, nomeOriginal: image.originalName, nomeArquivo: image.fileName, mimeType: image.mimeType, tamanhoBytes: image.size, caminho: image.relativePath, url: image.url }))
          });
        }
        await recordAudit({ actor: authUser, action: "UPDATE_BOOK", entityType: "BOOK", entityId: id, summary: `Book ${id} atualizado: ${upload.data.nome}.`, before: { nome: existing.nome, codigoFornecedor: existing.codigoFornecedor, periodo: existing.periodo }, after: { nome: upload.data.nome, codigoFornecedor: upload.data.codigoFornecedor, periodo: period.label, registros: recordIds.length } }, tx);
        return tx.book.findUniqueOrThrow({ where: { id }, include: bookInclude });
      });
      await deleteFiles(removedFiles);
      return { book: updated };
    } catch (error) {
      await fs.rm(upload.targetDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  });

  app.delete("/api/modules/promotores/books/:id", async (request, reply) => {
    const authUser = request.authUser!;
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ message: "Book invalido." });
    const existing = await prisma.book.findUnique({ where: { id }, include: { anexos: true } });
    if (!existing) return reply.code(404).send({ message: "Book nao encontrado." });
    await prisma.$transaction(async (tx) => {
      await tx.book.delete({ where: { id } });
      await recordAudit({ actor: authUser, action: "DELETE_BOOK", entityType: "BOOK", entityId: id, summary: `Book ${id} excluido: ${existing.nome}.`, before: { nome: existing.nome, codigoFornecedor: existing.codigoFornecedor, periodo: existing.periodo } }, tx);
    });
    await deleteFiles(existing.anexos.map((attachment) => path.join(env.attachmentsDir, attachment.caminho)));
    return reply.code(204).send();
  });
}
