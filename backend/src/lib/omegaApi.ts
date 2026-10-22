import { z } from "zod";
import { env } from "../config";

const nullableText = z.string().nullable();
const promoterEntrySchema = z.object({
  sourceId: z.string().uuid(),
  codpromotor: nullableText,
  promotor: nullableText,
  areaatuacao: nullableText,
  codcli: z.number().int(),
  cliente: nullableText,
  frequencia: nullableText,
  dia: nullableText,
  status: nullableText,
  obs: nullableText,
  dataInsercao: nullableText.optional(),
  sourceUpdatedAt: nullableText.optional()
});

const promoterEntriesResponseSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  entries: z.array(promoterEntrySchema)
});

export class OmegaApiError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "OmegaApiError";
  }
}

export async function listPromoterRoutes(input: { page: number; pageSize: number; query: string }) {
  if (!env.omegaApi.url || !env.omegaApi.key) {
    throw new OmegaApiError("Integracao com a API Omega nao configurada.", 503);
  }

  const url = new URL(`${env.omegaApi.url}/v1/promotores`);
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("page_size", String(input.pageSize));
  if (input.query) url.searchParams.set("q", input.query);

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(env.omegaApi.timeoutMs) && env.omegaApi.timeoutMs > 0
    ? env.omegaApi.timeoutMs
    : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-API-Key": env.omegaApi.key,
        "X-Client-Name": "solicitacoes-trade",
        Accept: "application/json"
      },
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      throw new OmegaApiError("API Omega recusou a consulta de promotores.", response.status === 401 ? 503 : 502);
    }

    const parsed = promoterEntriesResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new OmegaApiError("API Omega retornou dados de promotores invalidos.", 502);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof OmegaApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OmegaApiError("API Omega excedeu o tempo limite da consulta.", 504);
    }
    throw new OmegaApiError("API Omega indisponivel para consultar promotores.", 503);
  } finally {
    clearTimeout(timeout);
  }
}
