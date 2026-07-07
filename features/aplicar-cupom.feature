# language: pt
Funcionalidade: Aplicar cupom de desconto ao carrinho
  Como cliente da QualiCart
  Quero aplicar um cupom de desconto ao meu carrinho
  Para pagar menos pelos itens que estou comprando

  Cenário: Aplicar um cupom percentual de dez por cento
    Dado um carrinho com um item de cem reais
    Quando aplico um cupom percentual de dez por cento
    Então o total é noventa reais

  Esquema do Cenário: Aplicar cupons de diferentes tipos
    Dado um carrinho com um item de "<subtotal>" reais
    Quando aplico um cupom "<tipo>" de "<valor>"
    Então o total é "<total>" reais

    Exemplos:
      | subtotal | tipo       | valor | total |
      | 100      | percentual | 10    | 90    |
      | 200      | percentual | 25    | 150   |
      | 100      | fixo       | 30    | 70    |
      | 40       | fixo       | 50    | 0     |
