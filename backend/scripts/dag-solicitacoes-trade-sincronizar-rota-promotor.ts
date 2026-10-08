import "../src/config";
import { Client } from "pg";
import { env } from "../src/config";

type RequestRow = {
  id: number;
  action: "CREATE" | "UPDATE" | "DELETE";
  sourceId: string;
  requestedData: PromoterRouteData | null;
};

type PromoterRouteData = {
  codpromotor?: string | null;
  promotor?: string | null;
  areaatuacao?: string | null;
  codcli: number;
  cliente?: string | null;
  frequencia?: string | null;
  dia?: string | null;
  status?: string | null;
  obs?: string | null;
};

type LocalRow = PromoterRouteData & {
  sourceId: string;
  dataInsercao: Date | null;
  sourceUpdatedAt: Date | null;
};

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function tableRef(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

const localTable = tableRef(env.sourcePromoterRoute.schema, env.sourcePromoterRoute.table);

async function ensureLocalTableContract(local: Client): Promise<void> {
  await local.query(`alter table ${localTable} add column if not exists id uuid default gen_random_uuid()`);
  await local.query(`update ${localTable} set id = gen_random_uuid() where id is null`);
  await local.query(`alter table ${localTable} alter column id set default gen_random_uuid()`);
  await local.query(`alter table ${localTable} alter column id set not null`);
  await local.query(`alter table ${localTable} add column if not exists atualizado_em timestamptz default now()`);
  await local.query(`update ${localTable} set atualizado_em = now() where atualizado_em is null`);
  await local.query(`alter table ${localTable} alter column atualizado_em set default now()`);
  await local.query(`alter table ${localTable} alter column atualizado_em set not null`);

  const primaryKey = await local.query<{ exists: boolean }>(
    `select exists(select 1 from pg_constraint where conrelid = $1::regclass and contype = 'p') as exists`,
    [`${env.sourcePromoterRoute.schema}.${env.sourcePromoterRoute.table}`]
  );
  if (!primaryKey.rows[0]?.exists) {
    await local.query(`alter table ${localTable} add constraint dpromotor_pkey primary key (id)`);
  }

  const schema = quoteIdentifier(env.sourcePromoterRoute.schema);
  await local.query(`
    create or replace function ${schema}.solicitacoes_trade_set_dpromotor_atualizado_em()
    returns trigger as $$
    begin
      new.atualizado_em = now();
      return new;
    end;
    $$ language plpgsql
  `);
  await local.query(`drop trigger if exists solicitacoes_trade_set_atualizado_em on ${localTable}`);
  await local.query(`
    create trigger solicitacoes_trade_set_atualizado_em
    before update on ${localTable}
    for each row
    when (old.* is distinct from new.*)
    execute function ${schema}.solicitacoes_trade_set_dpromotor_atualizado_em()
  `);
}

async function readApprovedRequests(railway: Client): Promise<RequestRow[]> {
  const result = await railway.query<RequestRow>(`
    select id, action, "sourceId", "requestedData"
    from "PromoterRouteRequest"
    where status = 'APPROVED'
    order by "reviewedAt", id
  `);
  return result.rows;
}

function values(data: PromoterRouteData): Array<string | number | null> {
  return [
    data.codpromotor || null,
    data.promotor || null,
    data.areaatuacao || null,
    data.codcli,
    data.cliente || null,
    data.frequencia || null,
    data.dia || null,
    data.status || null,
    data.obs || null
  ];
}

async function applyRequest(local: Client, request: RequestRow): Promise<void> {
  if (request.action !== "DELETE" && !request.requestedData) {
    throw new Error("Solicitacao sem dados para aplicacao.");
  }

  if (request.action === "CREATE") {
    await local.query(
      `
        insert into ${localTable}
          (id, codpromotor, promotor, areaatuacao, codcli, cliente, frequencia, dia, status, obs)
        values ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (id) do nothing
      `,
      [request.sourceId, ...values(request.requestedData!)]
    );
    return;
  }

  if (request.action === "UPDATE") {
    const result = await local.query(
      `
        update ${localTable}
        set codpromotor=$2, promotor=$3, areaatuacao=$4, codcli=$5, cliente=$6,
            frequencia=$7, dia=$8, status=$9, obs=$10
        where id=$1::uuid
      `,
      [request.sourceId, ...values(request.requestedData!)]
    );
    if (!result.rowCount) throw new Error(`Registro local ${request.sourceId} nao encontrado.`);
    return;
  }

  await local.query(`delete from ${localTable} where id=$1::uuid`, [request.sourceId]);
}

async function markApplied(railway: Client, request: RequestRow): Promise<void> {
  await railway.query("begin");
  try {
    await railway.query(
      `update "PromoterRouteRequest" set status='APPLIED', "appliedAt"=now(), "applyError"=null, "updatedAt"=now() where id=$1 and status='APPROVED'`,
      [request.id]
    );
    await railway.query(
      `
        insert into "AuditLog" (action, "entityType", "entityId", summary, metadata, "createdAt")
        values ('APPLY_PROMOTER_ROUTE_REQUEST','PROMOTER_ROUTE_REQUEST',$1,$2,$3::jsonb,now())
      `,
      [String(request.id), `Solicitacao de rota de promotor ${request.id} aplicada no Omega.`, JSON.stringify({ sourceId: request.sourceId })]
    );
    await railway.query("commit");
  } catch (error) {
    await railway.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function markFailed(railway: Client, request: RequestRow, error: unknown): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  await railway.query(
    `update "PromoterRouteRequest" set status='FAILED', "applyError"=$2, "updatedAt"=now() where id=$1 and status='APPROVED'`,
    [request.id, message]
  );
}

async function readLocalRows(local: Client): Promise<LocalRow[]> {
  const result = await local.query<LocalRow>(`
    select id::text as "sourceId", codpromotor, promotor, areaatuacao, codcli, cliente,
           frequencia, dia, status, obs, data_insercao as "dataInsercao", atualizado_em as "sourceUpdatedAt"
    from ${localTable}
    order by id
  `);
  if (!result.rows.length) throw new Error("dpromotor local vazia; sincronizacao abortada por seguranca.");
  return result.rows;
}

async function syncSnapshot(railway: Client, rows: LocalRow[]): Promise<void> {
  await railway.query("begin");
  try {
    for (let index = 0; index < rows.length; index += 300) {
      const chunk = rows.slice(index, index + 300);
      const params: Array<string | number | Date | null> = [];
      const tuples = chunk.map((row, offset) => {
        const start = offset * 13;
        params.push(
          row.sourceId,
          row.codpromotor || null,
          row.promotor || null,
          row.areaatuacao || null,
          row.codcli,
          row.cliente || null,
          row.frequencia || null,
          row.dia || null,
          row.status || null,
          row.obs || null,
          row.dataInsercao,
          row.sourceUpdatedAt,
          new Date()
        );
        return `($${start + 1}::uuid,$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6},$${start + 7},$${start + 8},$${start + 9},$${start + 10},$${start + 11},$${start + 12},$${start + 13},$${start + 13})`;
      });
      await railway.query(
        `
          insert into "PromoterRouteEntry"
            ("sourceId",codpromotor,promotor,areaatuacao,codcli,cliente,frequencia,dia,status,obs,"dataInsercao","sourceUpdatedAt","createdAt","updatedAt")
          values ${tuples.join(",")}
          on conflict ("sourceId") do update set
            codpromotor=excluded.codpromotor, promotor=excluded.promotor, areaatuacao=excluded.areaatuacao,
            codcli=excluded.codcli, cliente=excluded.cliente, frequencia=excluded.frequencia,
            dia=excluded.dia, status=excluded.status, obs=excluded.obs,
            "dataInsercao"=excluded."dataInsercao", "sourceUpdatedAt"=excluded."sourceUpdatedAt", "updatedAt"=now()
        `,
        params
      );
    }
    await railway.query(`delete from "PromoterRouteEntry" where not ("sourceId" = any($1::uuid[]))`, [rows.map((row) => row.sourceId)]);
    await railway.query("commit");
  } catch (error) {
    await railway.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function main() {
  if (!env.sourceRca.databaseUrl) throw new Error("SOURCE_DATABASE_URL nao configurada.");
  if (!env.databaseUrl) throw new Error("DATABASE_URL nao configurada para o Railway.");

  const local = new Client({ connectionString: env.sourceRca.databaseUrl });
  const railway = new Client({ connectionString: env.databaseUrl });
  await local.connect();
  await railway.connect();
  try {
    await local.query("set time zone 'America/Fortaleza'");
    await railway.query("set time zone 'America/Fortaleza'");
    await ensureLocalTableContract(local);

    const requests = await readApprovedRequests(railway);
    let applied = 0;
    let failed = 0;
    for (const request of requests) {
      try {
        await local.query("begin");
        await applyRequest(local, request);
        await local.query("commit");
        await markApplied(railway, request);
        applied += 1;
      } catch (error) {
        await local.query("rollback").catch(() => undefined);
        await markFailed(railway, request, error);
        failed += 1;
      }
    }

    const rows = await readLocalRows(local);
    await syncSnapshot(railway, rows);
    console.log("Solicitacoes-Trade | Rota de Promotor sincronizada.");
    console.log(`Solicitacoes aplicadas: ${applied}`);
    console.log(`Solicitacoes com falha: ${failed}`);
    console.log(`Linhas espelhadas: ${rows.length}`);
  } finally {
    await local.end();
    await railway.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
