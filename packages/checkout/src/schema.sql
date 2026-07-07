-- DDL da tabela de pedidos (usada pela migracao do teste de integracao).

CREATE TABLE IF NOT EXISTS pedidos (
  id         text PRIMARY KEY,
  subtotal   numeric      NOT NULL,
  desconto   numeric      NOT NULL,
  frete      numeric      NOT NULL,
  total      numeric      NOT NULL,
  itens      jsonb        NOT NULL,
  criado_em  timestamptz  NOT NULL DEFAULT now()
);
