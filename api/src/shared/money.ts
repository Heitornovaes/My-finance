// Fronteira entre "número que humano digita/lê" e "centavos inteiros que
// o banco guarda" (CLAUDE.md regra 1). O resto do sistema nunca lida com
// float — só aqui, e só de passagem.

// Aceita os dois formatos que aparecem em input de usuário BR:
//   "1.234,56"  -> ponto de milhar, vírgula decimal
//   "1234.56"   -> ponto decimal direto (ex.: cola de outro sistema)
// A presença de vírgula decide qual é: se tem vírgula, é formato BR e
// pontos viram separador de milhar (removidos); senão, o ponto já é o
// separador decimal.
export function parseMoneyToCents(input: string): number {
  const trimmed = input.trim();
  if (trimmed === '') {
    throw new Error(`Valor monetário vazio.`);
  }

  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`Valor monetário inválido: '${input}'.`);
  }

  return Math.round(Number(normalized) * 100);
}

export function formatCentsToBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const centavos = abs % 100;
  return `${sign}R$ ${reais.toLocaleString('pt-BR')},${String(centavos).padStart(2, '0')}`;
}
