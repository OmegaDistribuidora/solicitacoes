import "../src/config";
import { Client } from "pg";
import { env } from "../src/config";

type LocalRoutingRow = {
  codgerente: number | null;
  coordenador: string | null;
  codsup: number;
  supervisor: string;
  codusur: number;
  rca: string;
  codcli: number;
  cliente: string;
  dia: string;
  tipo: string;
  data_alteracao: Date;
};

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

async function readLocalFingerprint(local: Client): Promise<{ localHash: string; maxDataAlteracao: Date | null; total: number }> {
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

async function readChangedRows(local: Client, syncedUntil: Date | null): Promise<LocalRoutingRow[]> {
  const result = await local.query<LocalRoutingRow>(
    `
      select codgerente, coordenador, codsup, supervisor, codusur, rca, codcli, cliente, dia, tipo, data_alteracao
      from ${tableRef(env.sourceRouting.schema, env.sourceRouting.table)}
      where data_alteracao > coalesce($1::timestamptz, '1970-01-01'::timestamptz)
      order by data_alteracao, codusur, codcli
    `,
    [syncedUntil]
  );
  return result.rows;
}

async function readAllKeys(local: Client): Promise<Array<{ codusur: number; codcli: number }>> {
  const result = await local.query<{ codusur: number; codcli: number }>(`
    select codusur, codcli
    from ${tableRef(env.sourceRouting.schema, env.sourceRouting.table)}
    order by codusur, codcli
  `);
  return result.rows;
}

async function upsertChangedRows(railway: Client, rows: LocalRoutingRow[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const values: string[] = [];
    const params: Array<number | string | Date | null> = [];

    chunk.forEach((row, offset) => {
      const start = offset * 11;
      values.push(
        `($${start + 1},$${start + 2},$${start + 3},$${start + 4},$${start + 5},$${start + 6},$${start + 7},$${start + 8},$${start + 9},$${start + 10},$${start + 11},now(),now())`
      );
      params.push(
        row.codgerente,
        row.coordenador,
        row.codsup,
        row.supervisor,
        row.codusur,
        row.rca,
        row.codcli,
        row.cliente,
        row.dia,
        row.tipo,
        row.data_alteracao
      );
    });

    await railway.query(
      `
        insert into "RoutingEntry" (
          "codgerente", "coordenador", "codsup", "supervisor", "codusur", "rca",
          "codcli", "cliente", "dia", "tipo", "dataAlteracao", "createdAt", "updatedAt"
        )
        values ${values.join(",")}
        on conflict ("codusur", "codcli") do update set
          "codgerente" = excluded."codgerente",
          "coordenador" = excluded."coordenador",
          "codsup" = excluded."codsup",
          "supervisor" = excluded."supervisor",
          "rca" = excluded."rca",
          "cliente" = excluded."cliente",
          "dia" = excluded."dia",
          "tipo" = excluded."tipo",
          "dataAlteracao" = excluded."dataAlteracao",
          "updatedAt" = now()
      `,
      params
    );
  }
}

async function deleteMissingRows(railway: Client, keys: Array<{ codusur: number; codcli: number }>): Promise<number> {
  await railway.query(`create temp table tmp_solicitacoes_trade_roteirizacao_keys (codusur int not null, codcli int not null) on commit drop`);

  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000);
    if (!chunk.length) continue;
    const values: string[] = [];
    const params: number[] = [];
    chunk.forEach((key, offset) => {
      values.push(`($${offset * 2 + 1}, $${offset * 2 + 2})`);
      params.push(key.codusur, key.codcli);
    });
    await railway.query(`insert into tmp_solicitacoes_trade_roteirizacao_keys (codusur, codcli) values ${values.join(",")}`, params);
  }

  const deleted = await railway.query(`
    delete from "RoutingEntry" r
    where not exists (
      select 1
      from tmp_solicitacoes_trade_roteirizacao_keys k
      where k.codusur = r."codusur"
        and k.codcli = r."codcli"
    )
  `);

  return deleted.rowCount || 0;
}

async function main() {
  if (!env.sourceRca.databaseUrl) {
    throw new Error("SOURCE_DATABASE_URL nao configurada.");
  }

  if (!env.databaseUrl) {
    throw new Error("DATABASE_URL nao configurada para o Railway.");
  }

  const local = new Client({ connectionString: env.sourceRca.databaseUrl });
  await local.connect();
  await local.query("set time zone 'America/Fortaleza'");

  try {
    await ensureSyncStateTable(local);

    const stateResult = await local.query<{ local_hash: string; synced_until: Date | null }>(
      `select local_hash, synced_until from ${tableRef(env.sourceRouting.schema, "fSolicitacoesTradeSyncState")} where sync_name = $1`,
      ["roteirizacao"]
    );
    const state = stateResult.rows[0] || null;
    const fingerprint = await readLocalFingerprint(local);

    if (state?.local_hash === fingerprint.localHash) {
      console.log("Solicitacoes-Trade | Roteirizacao sem alteracoes locais. Railway nao foi conectado.");
      console.log(`Linhas locais: ${fingerprint.total}`);
      return;
    }

    const changedRows = await readChangedRows(local, state?.synced_until || null);
    const allKeys = await readAllKeys(local);
    console.log("Solicitacoes-Trade | Alteracoes locais detectadas. Conectando ao Railway...");
    console.log(`Linhas locais: ${fingerprint.total}`);
    console.log(`Linhas novas/alteradas desde ultimo sync: ${changedRows.length}`);

    const railway = new Client({ connectionString: env.databaseUrl });
    await railway.connect();
    await railway.query("set time zone 'America/Fortaleza'");

    let deletedRows = 0;
    try {
      await railway.query("begin");
      await upsertChangedRows(railway, changedRows);
      deletedRows = await deleteMissingRows(railway, allKeys);
      await railway.query("commit");
    } catch (error) {
      await railway.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      await railway.end();
    }

    await local.query(
      `
        insert into ${tableRef(env.sourceRouting.schema, "fSolicitacoesTradeSyncState")} (sync_name, local_hash, synced_until, last_run_at)
        values ($1, $2, $3, now())
        on conflict (sync_name) do update set
          local_hash = excluded.local_hash,
          synced_until = excluded.synced_until,
          last_run_at = now()
      `,
      ["roteirizacao", fingerprint.localHash, fingerprint.maxDataAlteracao]
    );

    console.log("Solicitacoes-Trade | Roteirizacao sincronizada no Railway.");
    console.log(`Linhas inseridas/alteradas no Railway: ${changedRows.length}`);
    console.log(`Linhas deletadas no Railway por exclusao local: ${deletedRows}`);
  } finally {
    await local.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
