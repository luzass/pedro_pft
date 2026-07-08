# Painel de Operações

App simples para registrar operações, acompanhar operações abertas, enviar ações como parcial/fechamento e consolidar pontos por mês.

## O que já tem

- Tela de acesso usando usuários do Authentication do Supabase.
- Cadastro de operação com par, direção, entrada, stop e take.
- Ações de admin para parcial, fechamento manual, take profit cheio, stop loss e cancelamento.
- Pontos calculados automaticamente pelo preço da parcial/fechamento ou pelo take/stop cadastrados.
- Dashboard mensal com operações fechadas, pontos, gain, loss e taxa de acerto.
- Histórico de mensagens.
- Fila `message_queue` para enviar mensagens pelo WhatsApp via Evolution API.
- Configuração via `.env` local ou variáveis de ambiente na Vercel.

## Como preparar o Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor.
3. Rode o conteúdo de `supabase-schema.sql`. Se já rodou antes, pode rodar de novo para atualizar tabelas, triggers e permissões.
4. Em Authentication, crie o usuário que será admin.
5. Depois de criar o usuário, rode:

```sql
update public.profiles
set role = 'admin'
where email = 'email-do-admin@exemplo.com';
```

6. Rode o conteúdo de `supabase-check.sql` para conferir se as tabelas e o perfil admin estão prontos.

## Como abrir o app

Crie um `.env` na raiz do projeto usando o `.env.example` como modelo:

```bash
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key

EVOLUTION_API_URL=https://casa-oceano-evolution-api.cj1us3.easypanel.host
EVOLUTION_API_KEY=sua-chave-da-evolution
EVOLUTION_INSTANCE=lucas
EVOLUTION_GROUP_ID=120363410138143356@g.us
```

Abra `index.html` no navegador ou rode um servidor local nesta pasta:

```bash
node dev-server.js 5173
```

Depois acesse `http://127.0.0.1:5173/index.html`.

No Windows, você também pode abrir `abrir-app.bat`.

Não use Live Server/porta `5500` para testar envio. Ele só serve arquivos estáticos e não roda as rotas `/api/config` e `/api/send-queued`.

No app:

1. Entre com email e senha.
2. Acesse o Dashboard ou o Painel de operações.
3. Cadastre novas operações e acompanhe as abertas abaixo do formulário.

Se o `.env` não existir, o app ainda permite preencher a URL e anon key manualmente para teste local.

## Vercel

Antes de importar na Vercel, suba o projeto para o GitHub:

```powershell
.\subir-git.ps1
```

Ou dê duplo clique em `subir-git.bat`.

Configure estas variáveis no projeto da Vercel:

```bash
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key
EVOLUTION_API_URL=https://casa-oceano-evolution-api.cj1us3.easypanel.host
EVOLUTION_API_KEY=sua-chave-da-evolution
EVOLUTION_INSTANCE=lucas
EVOLUTION_GROUP_ID=120363410138143356@g.us
CRON_SECRET=um-token-grande-e-aleatorio
```

O app lê esses valores pela rota `/api/config`.

## Envio pela Evolution

A URL que deve entrar em `EVOLUTION_API_URL` é a base da API, sem `/manager/...`.

Use:

```bash
EVOLUTION_API_URL=https://casa-oceano-evolution-api.cj1us3.easypanel.host
```

A rota `/api/send-queued` busca registros com `status = 'queued'`, envia para o grupo pela Evolution API e atualiza para `sent`. Quando o admin cria uma operação, manda parcial ou fecha a operação, o app chama essa rota automaticamente.

Formato da abertura:

```txt
*VENDA OU COMPRA*
Ativo: *EUR/USD*
Operação n°: 1

Preço de entrada: 
Stop Loss:
Take Profit:
```

Formato da parcial:

```txt
Operação n°: 1
*PARCIAL*

Preço da Parcial:
Fechar 50%
```

No take profit cheio e no stop loss, o admin só clica no botão e o app usa os preços cadastrados na abertura. Na parcial ou fechamento manual, o admin informa o preço e o app calcula os pontos automaticamente. Quando a operação fecha ou stopa, o banco soma os pontos das parciais com os pontos finais e grava o total da operação para o dashboard.

As mensagens enviadas para o WhatsApp usam ponto decimal nos preços, por exemplo `1.33411`, para facilitar copiar e colar. O botão `Enviar pendentes` só aparece quando existe mensagem com `status = 'queued'` na tabela `message_queue`.

Use n8n se você quiser montar o fluxo visualmente, com painéis de retry, alertas e integrações extras. Para este MVP, a integração direta com Evolution API é mais simples e tem menos peças no caminho.

Não coloque `SUPABASE_SERVICE_ROLE_KEY` nem `EVOLUTION_API_KEY` no navegador. Elas devem ficar apenas no `.env` local ou nas variáveis de ambiente da Vercel.
