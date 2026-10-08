from __future__ import annotations

import os
import subprocess
from datetime import timedelta

import pendulum
from airflow import DAG
from airflow.exceptions import AirflowException
from airflow.models import Variable
from airflow.providers.standard.operators.python import PythonOperator


APP_LINUX = os.getenv("SOLICITACOES_TRADE_APP_LINUX", "/mnt/c/Repos/solicitacoes")
NPM_BIN = os.getenv("SOLICITACOES_TRADE_NPM_BIN", "/mnt/c/Program Files/nodejs/npm")
LOCAL_TZ = pendulum.timezone("America/Sao_Paulo")


def _variable(name: str, default: str | None = None) -> str:
    value = Variable.get(name, default_var=default)
    if value is None or not str(value).strip():
        raise AirflowException(f"Airflow Variable obrigatoria nao configurada: {name}")
    return str(value).strip()


def _run_sync() -> None:
    env = os.environ.copy()
    forwarded = {
        "DATABASE_URL": _variable("SOLICITACOES_TRADE_DATABASE_URL"),
        "SOURCE_DATABASE_URL": _variable("SOLICITACOES_TRADE_SOURCE_DATABASE_URL"),
        "SOURCE_PROMOTER_ROUTE_SCHEMA": _variable("SOLICITACOES_TRADE_SOURCE_PROMOTER_ROUTE_SCHEMA", "filial"),
        "SOURCE_PROMOTER_ROUTE_TABLE": _variable("SOLICITACOES_TRADE_SOURCE_PROMOTER_ROUTE_TABLE", "dpromotor"),
        "NO_COLOR": "1",
        "FORCE_COLOR": "0",
    }
    env.update(forwarded)
    env["PATH"] = f"/mnt/c/Program Files/nodejs:{env.get('PATH', '')}"
    wslenv = [item for item in env.get("WSLENV", "").split(":") if item]
    known = {item.split("/", 1)[0] for item in wslenv}
    for key in forwarded:
        if key not in known:
            wslenv.append(f"{key}/w")
    env["WSLENV"] = ":".join(wslenv)

    result = subprocess.run(
        [NPM_BIN, "run", "dag:solicitacoes-trade:sincronizar-rota-promotor"],
        cwd=APP_LINUX,
        env=env,
        capture_output=True,
        check=False,
    )
    for content in (result.stdout, result.stderr):
        if content:
            print(content.decode("utf-8", errors="replace").strip())
    if result.returncode != 0:
        raise AirflowException(f"Sincronizacao finalizou com codigo {result.returncode}.")


with DAG(
    dag_id="solicitacoes_trade_sincronizar_rota_promotor",
    description="Aplica no Omega as solicitacoes aprovadas de rota de promotor e atualiza o espelho do sistema.",
    default_args={
        "owner": "omega",
        "depends_on_past": False,
        "retries": 2,
        "retry_delay": timedelta(minutes=1),
    },
    start_date=pendulum.datetime(2026, 10, 8, 0, 0, 0, tz=LOCAL_TZ),
    schedule="*/1 * * * *",
    catchup=False,
    max_active_runs=1,
    dagrun_timeout=timedelta(minutes=5),
    is_paused_upon_creation=True,
    tags=["solicitacoes-trade", "rota-promotor", "omega"],
) as dag:
    PythonOperator(task_id="sincronizar_rota_promotor", python_callable=_run_sync)
