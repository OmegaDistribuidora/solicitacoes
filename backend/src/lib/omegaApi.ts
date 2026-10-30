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
  sourceUpdatedAt: z.string()
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

type PromoterRouteData = {
  codpromotor: string | null;
  promotor: string | null;
  areaatuacao: string | null;
  codcli: number;
  cliente: string | null;
  frequencia: string | null;
  dia: string | null;
  status: string | null;
  obs: string | null;
};

type PromoterRouteMutation =
  | { action: "CREATE"; sourceId: string; data: PromoterRouteData }
  | { action: "UPDATE"; sourceId: string; expectedUpdatedAt: string; data: PromoterRouteData }
  | { action: "DELETE"; sourceId: string; expectedUpdatedAt: string };

const promoterMutationResponseSchema = z.object({
  previous: promoterEntrySchema.nullable(),
  entry: promoterEntrySchema.nullable()
});

const omegaCustomerSchema = z.object({
  codigo: z.number().int().positive(),
  nome: z.string(),
  fantasia: z.string().nullable().optional(),
  cidade: z.string()
});

const omegaCustomersResponseSchema = z.object({
  clientes: z.array(omegaCustomerSchema)
});

export type OmegaCustomer = {
  codigo: number;
  nome: string;
  fantasia?: string | null;
  cidade: string;
};

type CustomerCacheEntry = {
  value: OmegaCustomer;
  expiresAt: number;
};

const CUSTOMER_CACHE_MAX_ENTRIES = 10000;
const customerCache = new Map<number, CustomerCacheEntry>();

function customerCacheTtlMs(): number {
  const configured = env.omegaApi.customerCacheTtlMs;
  return Number.isFinite(configured) && configured > 0 ? configured : 60 * 24 * 60 * 60 * 1000;
}

function pruneCustomerCache(now: number): void {
  for (const [code, entry] of customerCache) {
    if (entry.expiresAt <= now) customerCache.delete(code);
  }
  while (customerCache.size >= CUSTOMER_CACHE_MAX_ENTRIES) {
    const oldestCode = customerCache.keys().next().value as number | undefined;
    if (oldestCode === undefined) break;
    customerCache.delete(oldestCode);
  }
}

async function omegaApiError(response: Response, fallback: string): Promise<OmegaApiError> {
  let message = fallback;
  try {
    const payload = await response.json() as { detail?: unknown };
    if (typeof payload.detail === "string" && payload.detail.trim()) message = payload.detail;
  } catch {
    // Mantem a mensagem padrao quando o corpo nao for JSON.
  }
  const statusCode = response.status === 401
    ? 503
    : response.status === 422
      ? 400
      : response.status;
  return new OmegaApiError(message, statusCode);
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
      throw await omegaApiError(response, "API Omega recusou a consulta de promotores.");
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

export async function applyPromoterRouteChange(input: PromoterRouteMutation) {
  if (!env.omegaApi.url || !env.omegaApi.key || !env.omegaApi.writeKey) {
    throw new OmegaApiError("Integracao de escrita com a API Omega nao configurada.", 503);
  }

  const isCreate = input.action === "CREATE";
  const url = isCreate
    ? `${env.omegaApi.url}/v1/promotores`
    : `${env.omegaApi.url}/v1/promotores/${encodeURIComponent(input.sourceId)}`;
  const body = isCreate
    ? { sourceId: input.sourceId, data: input.data }
    : input.action === "UPDATE"
      ? { expectedUpdatedAt: input.expectedUpdatedAt, data: input.data }
      : { expectedUpdatedAt: input.expectedUpdatedAt };

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(env.omegaApi.timeoutMs) && env.omegaApi.timeoutMs > 0
    ? env.omegaApi.timeoutMs
    : 10000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: isCreate ? "POST" : input.action === "UPDATE" ? "PATCH" : "DELETE",
      headers: {
        "X-API-Key": env.omegaApi.key,
        "X-Write-API-Key": env.omegaApi.writeKey,
        "X-Client-Name": "solicitacoes-trade",
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) {
      throw await omegaApiError(response, "API Omega recusou a alteracao da rota de promotor.");
    }

    const parsed = promoterMutationResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new OmegaApiError("API Omega retornou uma resposta de alteracao invalida.", 502);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof OmegaApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OmegaApiError("API Omega excedeu o tempo limite da alteracao.", 504);
    }
    throw new OmegaApiError("API Omega indisponivel para alterar a rota de promotor.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

export async function getOmegaCustomers(customerCodes: number[]): Promise<OmegaCustomer[]> {
  if (!env.omegaApi.url || !env.omegaApi.key) {
    throw new OmegaApiError("Integracao com a API Omega nao configurada.", 503);
  }
  const codes = [...new Set(customerCodes.filter((code) => Number.isInteger(code) && code > 0))];
  if (!codes.length) return [];
  const now = Date.now();
  pruneCustomerCache(now);
  const missingCodes = codes.filter((code) => {
    const cached = customerCache.get(code);
    return !cached || cached.expiresAt <= now;
  });
  for (let offset = 0; offset < missingCodes.length; offset += 200) {
    const chunk = missingCodes.slice(offset, offset + 200);
    const controller = new AbortController();
    const timeoutMs = Number.isFinite(env.omegaApi.timeoutMs) && env.omegaApi.timeoutMs > 0
      ? env.omegaApi.timeoutMs
      : 10000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const singleCustomer = chunk.length === 1;
      const response = await fetch(singleCustomer
        ? `${env.omegaApi.url}/v1/clientes/${chunk[0]}`
        : `${env.omegaApi.url}/v1/clientes/consultar`, {
        method: singleCustomer ? "GET" : "POST",
        headers: {
          "X-API-Key": env.omegaApi.key,
          "X-Client-Name": "solicitacoes-trade-books",
          ...(!singleCustomer ? { "Content-Type": "application/json" } : {}),
          Accept: "application/json"
        },
        body: singleCustomer ? undefined : JSON.stringify({ codigos: chunk }),
        signal: controller.signal,
        cache: "no-store"
      });
      let fetchedCustomers: OmegaCustomer[] = [];
      if (singleCustomer && response.status === 404) {
        fetchedCustomers = [];
      } else {
        if (!response.ok) throw await omegaApiError(response, "API Omega recusou a consulta de clientes.");
        const payload = await response.json();
        const parsed = singleCustomer
          ? omegaCustomerSchema.safeParse(payload)
          : omegaCustomersResponseSchema.safeParse(payload);
        if (!parsed.success) {
          throw new OmegaApiError("API Omega retornou dados de clientes invalidos.", 502);
        }
        fetchedCustomers = singleCustomer
          ? [parsed.data as OmegaCustomer]
          : (parsed.data as { clientes: OmegaCustomer[] }).clientes;
      }
      const fetchedByCode = new Map(fetchedCustomers.map((customer) => [customer.codigo, customer]));
      const positiveExpiration = Date.now() + customerCacheTtlMs();
      for (const code of chunk) {
        const customer = fetchedByCode.get(code);
        if (!customer) continue;
        customerCache.delete(code);
        customerCache.set(code, { value: customer, expiresAt: positiveExpiration });
      }
    } catch (error) {
      if (error instanceof OmegaApiError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new OmegaApiError("API Omega excedeu o tempo limite da consulta de clientes.", 504);
      }
      throw new OmegaApiError("API Omega indisponivel para consultar clientes.", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
  return codes.flatMap((code) => {
    const entry = customerCache.get(code);
    return entry ? [entry.value] : [];
  });
}
