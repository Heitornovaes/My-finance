// Sem toISOString() em lugar nenhum aqui (CLAUDE.md regra 4): ele converte
// pra UTC a partir do horário LOCAL da máquina, e como o servidor roda em
// UTC-3, isso desloca a borda do mês perto da meia-noite. Toda função
// aqui só lê/escreve componentes UTC explícitos (getUTC*), nunca depende
// do fuso local.

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
  // dia 0 do mês seguinte == último dia deste mês
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthStart(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

export function monthEnd(year: number, month: number): string {
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}

// Só pra formatar uma Date construída explicitamente em UTC
// (new Date(Date.UTC(...))) como 'YYYY-MM-DD'. Não use com `new Date()`
// direto (hora atual) — isso é responsabilidade de quem chama.
export function toISODate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${year}-${pad2(month)}-${pad2(day)}`;
}
