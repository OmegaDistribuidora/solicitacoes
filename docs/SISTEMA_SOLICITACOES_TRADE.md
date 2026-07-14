# Sistema Solicitacoes Trade

## Visao geral

O Solicitacoes Trade e um sistema web para controle de solicitacoes dos modulos Trade. A primeira entrega contempla o modulo de Roteirizacao, administracao de usuarios, controle de acesso por modulo, importacao por planilha, aprovacao/recusa de solicitacoes e rotinas de sincronizacao com bancos Postgres.

O sistema roda online no Railway, com banco Postgres tambem no Railway. O desenvolvimento local usa o mesmo monorepo, com backend Node/Fastify/Prisma e frontend React/Vite.

Todas as datas e horarios do backend e das rotinas usam o fuso `America/Fortaleza`.

## Autenticacao

Em producao, o sistema deve aceitar apenas login por SSO vindo do Ecossistema Omega. O login local existe somente para desenvolvimento e testes locais, controlado por `NODE_ENV` e `LOCAL_LOGIN_ENABLED`.

O SSO usa as variaveis:

- `ECOSYSTEM_SSO_ISSUER`
- `ECOSYSTEM_SSO_AUDIENCE`
- `ECOSYSTEM_SSO_SHARED_SECRET`
- `ECOSYSTEM_SSO_ADMIN_USERS`

Nenhuma senha de usuario e armazenada pelo sistema. O usuario local padrao de administracao e criado pelo seed usando `ADMIN_USERNAME` e `ADMIN_DISPLAY_NAME`.

## Perfis

Existem tres perfis:

- `ADMIN`: acesso total ao sistema, administracao de usuarios, modulos e permissoes.
- `ANALYST`: pode revisar solicitacoes de roteirizacao, aprovando ou recusando conforme a regra do modulo.
- `SUPERVISOR`: acessa somente os modulos e codigos de supervisor liberados pelo admin.

O acesso aos modulos fica registrado em `UserModuleAccess`. Para Roteirizacao, a permissao guarda a lista de codigos `codsup` que o usuario pode consultar e solicitar.

## Modulo Roteirizacao

O modulo consulta a tabela `RoutingEntry` no banco do Railway. Supervisores veem somente os registros dos codigos `codsup` liberados para o usuario. Admins e analistas podem ver e revisar todas as solicitacoes.

Campos principais da roteirizacao:

- `codgerente`
- `coordenador`
- `codsup`
- `supervisor`
- `codusur`
- `rca`
- `codcli`
- `cliente`
- `dia`
- `tipo`
- `dataAlteracao`

O nome do vendedor e a validacao de pertencimento a supervisor usam a tabela `base_rca`, nao a planilha importada.

## Solicitacoes

O supervisor pode criar solicitacoes de:

- Inclusao de rota
- Modificacao de rota
- Importacao por planilha

As solicitacoes entram como `PENDING`. Admins e analistas podem aprovar ou recusar. Ao recusar, o motivo fica gravado em `reviewReason` e aparece no historico do solicitante.

Na importacao por planilha, a pre-visualizacao mostra somente ajustes reais:

- Inclusoes aparecem com fundo verde.
- Modificacoes aparecem com fundo amarelo.
- Linhas iguais ao cadastro atual sao ocultadas e contabilizadas como "sem mudanca".

Se um supervisor importar uma planilha com qualquer vendedor fora dos seus codigos permitidos, a importacao e bloqueada e o sistema informa o RCA que causou o bloqueio.

## Banco do Railway

As principais tabelas no Postgres do Railway sao:

- `User`: usuarios do sistema.
- `UserModuleAccess`: permissoes por modulo e codigos de supervisor.
- `AuditLog`: trilha de auditoria das acoes relevantes.
- `base_rca`: base de gerentes, coordenadores, supervisores e vendedores.
- `RoutingEntry`: roteirizacao atual utilizada pelo modulo.
- `RouteRequest`: cabecalho das solicitacoes.
- `RouteRequestItem`: itens solicitados em cada solicitacao.

O schema do banco e gerenciado pelo Prisma em `backend/prisma/schema.prisma`.

## Banco local Omega

O banco local Omega, schema `filial`, participa das cargas operacionais.

Tabelas usadas pelo Solicitacoes Trade:

- `deqpcomercial`: origem da base RCA.
- `fRoteirizacao`: tabela local editavel com a roteirizacao consolidada.
- `fRoteiro`: agenda expandida, com uma linha por data de atendimento do cliente.
- `fSolicitacoesTradeSyncState`: estado das sincronizacoes do Solicitacoes Trade.

### fRoteirizacao

A tabela `filial."fRoteirizacao"` e a origem local para atualizar a roteirizacao no Railway. Ela possui chave por `codusur` e `codcli`, alem da coluna `data_alteracao`.

A coluna `data_alteracao` e atualizada automaticamente por trigger sempre que uma linha e inserida ou alterada. Ela permite que a rotina envie ao Railway somente linhas novas ou modificadas.

### fRoteiro

A tabela `filial."fRoteiro"` lista as datas em que cada cliente sera atendido entre junho de 2026 e dezembro de 2026.

Colunas:

- `data`
- `codcli`
- `dia_da_semana`
- `frequencia`
- `tipo`

Ela e recalculada a partir da `fRoteirizacao` somente quando a roteirizacao muda. Para quinzenas, a semana de domingo 12/07/2026 a sabado 18/07/2026 e considerada impar; as semanas seguintes alternam entre par e impar.

### fSolicitacoesTradeSyncState

A tabela `filial."fSolicitacoesTradeSyncState"` guarda o estado das rotinas de sincronizacao. Ela evita trabalho desnecessario e reduz conexoes externas.

Ela armazena, por rotina:

- Nome da sincronizacao.
- Hash/fingerprint da origem local.
- Ultima data sincronizada.
- Ultima execucao.

Na sincronizacao da roteirizacao com o Railway, a rotina primeiro calcula o estado local. Se nada mudou, ela encerra sem abrir conexao com o Railway.

## Rotinas e DAGs

Os scripts ficam em `backend/scripts` e tambem foram instalados no Airflow do WSL.

Scripts npm principais:

- `npm run solicitacoes-trade:criar-froteirizacao-local`
- `npm run dag:solicitacoes-trade:atualizar-base-rca`
- `npm run dag:solicitacoes-trade:atualizar-roteirizacao`
- `npm run dag:solicitacoes-trade:atualizar-froteiro`

DAGs no Airflow:

- `solicitacoes_trade_atualizar_base_rca`: atualiza a `base_rca` no Railway a partir da `deqpcomercial`. Frequencia: 1 hora.
- `solicitacoes_trade_atualizar_roteirizacao`: sincroniza `fRoteirizacao` local para `RoutingEntry` no Railway. Frequencia: 5 minutos.
- `solicitacoes_trade_atualizar_froteiro`: recalcula a `fRoteiro` local a partir da `fRoteirizacao`. Frequencia: 10 minutos.

A rotina da `base_rca` pode apagar e reinserir os vendedores porque o volume e pequeno. Ela considera apenas RCAs ativos, com bloqueio igual a `N`, e ignora time `Outros`.

A rotina de roteirizacao e incremental:

- Se nao houver mudanca local, nao conecta no Railway.
- Se houver linhas novas ou alteradas, faz UPSERT apenas dessas linhas.
- Se uma chave existir no Railway e nao existir mais na `fRoteirizacao` local, remove essa linha do Railway.

## CRUD local da fRoteirizacao

O CRUD completo da `filial."fRoteirizacao"` foi adicionado ao sistema local `modulo-tAux`, sem alterar os outros modulos. Esse CRUD serve para manter a tabela local que alimenta o Solicitacoes Trade.

## Variaveis de ambiente

Variaveis usadas pelo backend:

- `DATABASE_URL`
- `JWT_SECRET`
- `NODE_ENV`
- `PORT`
- `FRONTEND_URL`
- `LOCAL_LOGIN_ENABLED`
- `ADMIN_USERNAME`
- `ADMIN_DISPLAY_NAME`
- `ECOSYSTEM_SSO_ISSUER`
- `ECOSYSTEM_SSO_AUDIENCE`
- `ECOSYSTEM_SSO_SHARED_SECRET`
- `ECOSYSTEM_SSO_ADMIN_USERS`
- `SOURCE_DATABASE_URL`
- `SOURCE_RCA_SCHEMA`
- `SOURCE_RCA_TABLE`
- `SOURCE_ROUTING_SCHEMA`
- `SOURCE_ROUTING_TABLE`
- `SOURCE_ROTEIRO_TABLE`
- `SOURCE_ROTEIRO_START_DATE`
- `SOURCE_ROTEIRO_END_DATE`

Valores sensiveis devem ficar somente no Railway, em arquivos `.env` locais privados ou nas conexoes do Airflow. Eles nao devem ser versionados.

## Deploy

O Railway usa o monorepo com Nixpacks.

Comandos configurados:

- Build: `npm install --include=dev && npm run build`
- Start: `npm run start`

O backend executa `prisma db push --skip-generate` antes de iniciar, garantindo que o schema esteja aplicado no banco de producao.

## Cuidados operacionais

- Nao versionar credenciais, URLs com senha, planilhas de origem ou arquivos `.env`.
- Em producao, manter `NODE_ENV=production` e `LOCAL_LOGIN_ENABLED=false`.
- A URL publica do backend/frontend deve bater com `FRONTEND_URL` e com a configuracao do SSO.
- Apos mudancas de schema Prisma, rodar build local antes de publicar.
- Se uma credencial for exposta em chat, print ou repositorio, rotacionar no provedor correspondente.
