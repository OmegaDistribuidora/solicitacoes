import "../src/config";
import { Client } from "pg";
import { env } from "../src/config";

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function tableRef(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

async function ensureSyncStateTable(local: Client): Promise<void> {
  await local.query(`
    create table if not exists ${quoteIdentifier(env.sourceRouting.schema)}."fSolicitacoesTradeSyncState" (
      sync_name text primary key,
      local_hash text not null,
      synced_until timestamptz,
      last_run_at timestamptz not null default now()
    )
  `);
}

async function ensureRoteiroTable(local: Client): Promise<void> {
  await local.query(`
    create table if not exists ${tableRef(env.sourceRouting.schema, env.sourceRoteiro.table)} (
      data date not null,
      codcli int not null,
      dia_da_semana text not null,
      frequencia text not null,
      tipo text not null default ''
    )
  `);
  await local.query(`
    create index if not exists "fRoteiro_data_idx"
    on ${tableRef(env.sourceRouting.schema, env.sourceRoteiro.table)} (data)
  `);
  await local.query(`
    create index if not exists "fRoteiro_codcli_idx"
    on ${tableRef(env.sourceRouting.schema, env.sourceRoteiro.table)} (codcli)
  `);
}

async function readRoutingFingerprint(local: Client): Promise<{ localHash: string; maxDataAlteracao: Date | null; total: number }> {
  const result = await local.query<{ local_hash: string; max_data_alteracao: Date | null; total: string }>(`
    with row_hashes as (
      select
        codusur,
        codcli,
        data_alteracao,
        md5(concat_ws('|',
          coalesce(codgerente::text, ''),
          coalesce(coordenador, ''),
          codsup::text,
          supervisor,
          codusur::text,
          rca,
          codcli::text,
          cliente,
          dia,
          tipo
        )) as row_hash
      from ${tableRef(env.sourceRouting.schema, env.sourceRouting.table)}
    )
    select
      md5(count(*)::text || ':' || coalesce(string_agg(row_hash, ',' order by codusur, codcli), '')) as local_hash,
      max(data_alteracao) as max_data_alteracao,
      count(*)::text as total
    from row_hashes
  `);

  const row = result.rows[0];
  return {
    localHash: row.local_hash,
    maxDataAlteracao: row.max_data_alteracao,
    total: Number(row.total || 0)
  };
}

async function rebuildRoteiro(local: Client): Promise<number> {
  const result = await local.query<{ inserted_rows: string }>(
    `
      with deleted as (
        delete from ${tableRef(env.sourceRouting.schema, env.sourceRoteiro.table)}
      ),
      calendario as (
        select generate_series($1::date, $2::date, interval '1 day')::date as data
      ),
      roteirizacao as (
        select distinct
          codcli,
          dia,
          tipo,
          case dia
            when 'Segunda-Feira' then 1
            when 'Terça-Feira' then 2
            when 'Quarta-Feira' then 3
            when 'Quinta-Feira' then 4
            when 'Sexta-Feira' then 5
            when 'Sábado' then 6
            else null
          end as iso_dow
        from ${tableRef(env.sourceRouting.schema, env.sourceRouting.table)}
      ),
      linhas as (
        select
          c.data,
          r.codcli,
          case extract(isodow from c.data)::int
            when 1 then 'Segunda'
            when 2 then 'Terça'
            when 3 then 'Quarta'
            when 4 then 'Quinta'
            when 5 then 'Sexta'
            when 6 then 'Sábado'
          end as dia_da_semana,
          case when r.tipo = 'Semanal' then 'Semanal' else 'Quinzenal' end as frequencia,
          case
            when r.tipo = 'Semanal' then ''
            when r.tipo like 'Quinzena 1%' then 'Ímpar'
            else 'Par'
          end as tipo
        from calendario c
        join roteirizacao r
          on r.iso_dow = extract(isodow from c.data)::int
        where r.iso_dow between 1 and 6
          and (
            r.tipo = 'Semanal'
            or (
              r.tipo like 'Quinzena 1%'
              and (((c.data - extract(dow from c.data)::int) - date '2026-07-12') / 7) % 2 = 0
            )
            or (
              r.tipo like 'Quinzena 2%'
              and (((c.data - extract(dow from c.data)::int) - date '2026-07-12') / 7) % 2 <> 0
            )
          )
      ),
      inserted as (
        insert into ${tableRef(env.sourceRouting.schema, env.sourceRoteiro.table)} (
          data,
          codcli,
          dia_da_semana,
          frequencia,
          tipo
        )
        select data, codcli, dia_da_semana, frequencia, tipo
        from linhas
        order by data, codcli
        returning 1
      )
      select count(*)::text as inserted_rows
      from inserted
    `,
    [env.sourceRoteiro.startDate, env.sourceRoteiro.endDate]
  );

  return Number(result.rows[0]?.inserted_rows || 0);
}

async function main() {
  if (!env.sourceRca.databaseUrl) {
    throw new Error("SOURCE_DATABASE_URL nao configurada.");
  }

  const local = new Client({ connectionString: env.sourceRca.databaseUrl });
  await local.connect();
  await local.query("set time zone 'America/Fortaleza'");

  try {
    await ensureSyncStateTable(local);
    await ensureRoteiroTable(local);

    const stateResult = await local.query<{ local_hash: string; synced_until: Date | null }>(
      `select local_hash, synced_until from ${tableRef(env.sourceRouting.schema, "fSolicitacoesTradeSyncState")} where sync_name = $1`,
      ["roteiro"]
    );
    const state = stateResult.rows[0] || null;
    const fingerprint = await readRoutingFingerprint(local);

    if (state?.local_hash === fingerprint.localHash) {
      console.log("Solicitacoes-Trade | fRoteiro sem alteracoes na fRoteirizacao. Nada foi recalculado.");
      console.log(`Linhas na fRoteirizacao: ${fingerprint.total}`);
      return;
    }

    let insertedRows = 0;
    await local.query("begin");
    try {
      insertedRows = await rebuildRoteiro(local);
      await local.query(
        `
          insert into ${tableRef(env.sourceRouting.schema, "fSolicitacoesTradeSyncState")} (sync_name, local_hash, synced_until, last_run_at)
          values ($1, $2, $3, now())
          on conflict (sync_name) do update set
            local_hash = excluded.local_hash,
            synced_until = excluded.synced_until,
            last_run_at = now()
        `,
        ["roteiro", fingerprint.localHash, fingerprint.maxDataAlteracao]
      );
      await local.query("commit");
    } catch (error) {
      await local.query("rollback").catch(() => undefined);
      throw error;
    }

    console.log("Solicitacoes-Trade | fRoteiro recalculada a partir da fRoteirizacao.");
    console.log(`Periodo: ${env.sourceRoteiro.startDate} ate ${env.sourceRoteiro.endDate}`);
    console.log(`Linhas na fRoteirizacao: ${fingerprint.total}`);
    console.log(`Linhas geradas na fRoteiro: ${insertedRows}`);
  } finally {
    await local.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
