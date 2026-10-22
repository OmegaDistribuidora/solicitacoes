# Solicitacoes Trade

Sistema web para solicitacoes dos modulos Trade. A primeira entrega inclui login SSO compativel com o Sistema de Pagamentos, administracao de usuarios, base RCA, roteirizacao, solicitacoes de inclusao/modificacao e importacao por planilha.

## Desenvolvimento

1. Copie `.env.example` para `.env` e ajuste `DATABASE_URL`.
2. Instale dependencias:

```bash
npm install
```

3. Crie as tabelas:

```bash
npm run prisma:push
```

4. Suba o app:

```bash
npm run dev
```

Em desenvolvimento local, o login local usa apenas o campo `login`. Em producao (`NODE_ENV=production`) o login local fica bloqueado e o acesso deve vir pelo SSO do Ecossistema Omega.

## Cargas

Importacao inicial da planilha de roteirizacao:

```bash
npm run import:routing -- "C:\Users\POWERBI\Desktop\Rota completa.xlsx"
```

Sincronizacao da `base_rca` a partir do Postgres local:

```bash
npm run sync:base-rca
```

As datas do backend rodam com `TZ=America/Fortaleza`.

## Promotores

A aba `Promotores / Rota` consulta e altera `filial.dpromotor` imediatamente
pela API Omega. Inclusoes, edicoes e exclusoes nao dependem de DAG. O codigo do
cliente deve ser maior que zero e nao pode estar cadastrado em outra rota.
