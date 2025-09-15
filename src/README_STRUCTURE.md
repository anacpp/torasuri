Estrutura proposta do projeto (torasuri):

src/
  server.ts                 # Bootstrap HTTP + Discord
  core/
    logger.ts               # Logger central (pino)
  bot/
    client.ts               # Configuração e inicialização do client do Discord
    commands/
      ping.ts               # Exemplo de comando
    events/
      interactionCreate.ts  # Handler de interações
      ready.ts              # Evento ready
  http/
    routes/
      index.ts              # Registro de rotas Express
    middlewares/            # (futuros middlewares)
  utils/
    env.ts                  # Validação de variáveis de ambiente com Zod
  config/                   # (configs específicas)
  services/                 # (lógica de negócio / integrações externas)
  schemas/                  # (schemas Zod adicionais)
  types/                    # (tipagens globais)

Outros arquivos:
  tsconfig.json             # Configuração TS com aliases
  .eslintrc.cjs             # ESLint
  .prettierrc               # Prettier
  .env.example              # Exemplo de variáveis de ambiente
