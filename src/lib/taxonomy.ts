import { z } from "zod";

export const TAXONOMY = [
  { id: "politica-interna", label: "Política interna", description: "Governo, eleições, partidos e instituições do Brasil.", aliases: ["Política interna (Brasil)", "Política brasileira", "Política nacional", "Brazilian politics", "Domestic politics", "Eleições", "Eleições brasileiras", "Eleições e votos anulados", "Renan Santos", "Renan Santos e Dilma", "Renan Santos e eleições", "Renan Santos e política", "Política e Renan Santos", "Votos nulos", "Congresso", "Governo brasileiro"] },
  { id: "politica-externa", label: "Política externa", description: "Relações entre países, diplomacia e geopolítica. Mencionar outro país, por si só, não define este tema.", aliases: ["Política externa (relações internacionais)", "Relações internacionais", "Política internacional", "Geopolítica", "Diplomacia", "Foreign policy", "International politics", "International relations", "Geopolitics", "Internacionalização e política"] },
  { id: "tecnologia", label: "Tecnologia", description: "IA, programação, software, hardware, redes e suporte técnico, sem subdivisões.", aliases: ["Technology", "Tech", "IA", "Inteligência artificial", "Artificial intelligence", "IA aplicada a código", "Programação", "Programação e auditoria", "Programming", "Desenvolvimento de software", "Software", "Hardware", "Hardware e desempenho de PC", "Processadores", "Computadores", "Mensageria descentralizada", "Suporte técnico", "Segurança digital", "Cibersegurança"] },
  { id: "ciencia-saude", label: "Ciência e saúde", description: "Pesquisa científica, meio ambiente, medicina e saúde.", aliases: ["Ciência", "Science", "Saúde", "Health", "Science and health", "Medicina", "Pesquisa científica", "Biologia", "Astronomia", "Física", "Meio ambiente"] },
  { id: "economia-trabalho", label: "Economia e trabalho", description: "Economia, finanças, negócios, emprego e carreira.", aliases: ["Economia", "Economy", "Economics", "Economy and work", "Trabalho", "Work", "Carreira", "Relato de trabalho", "Relato profissional", "Trabalho noturno", "Finanças", "Finance", "Investimentos", "Mercado financeiro", "Dívida dos EUA", "Ações e Zona Franca de Manaus", "Negócios", "Empreendedorismo"] },
  { id: "sociedade-cotidiano", label: "Sociedade e cotidiano", description: "Vida cotidiana, comportamento, educação, mobilidade, automóveis e animais.", aliases: ["Sociedade", "Society", "Society and daily life", "Cotidiano", "Daily life", "Comportamento", "Educação", "Segurança pública", "Mobilidade", "Automóveis", "Aluguel de carros", "Coleção de carros", "Oficina automotiva", "Carros", "Cars", "Animais", "Animais de estimação", "Animals", "Pets", "Relacionamentos"] },
  { id: "cultura-lazer", label: "Cultura e lazer", description: "Artes, jogos, entretenimento, esportes, viagens e lazer.", aliases: ["Cultura", "Culture", "Culture and leisure", "Lazer", "Entretenimento", "Entertainment", "Jogos", "Games", "Gaming", "Cultura e jogos", "Mercado de jogos", "Música", "Cinema", "Filmes", "Filme ligado a Renan", "Séries", "Literatura", "Arte", "Humor", "Reação humorística", "Memes", "Esportes", "Sports", "Turismo", "Viagens", "Gastronomia"] },
  { id: "outros", label: "Outros", description: "Conteúdo sem contexto suficiente ou que não cabe com segurança nos demais temas.", aliases: ["Other", "Others", "Miscellaneous", "Sem contexto", "Não classificado"] },
] as const;
export type ThemeId = typeof TAXONOMY[number]["id"];
export const THEME_IDS = TAXONOMY.map(theme => theme.id);
export const themeSchema = z.enum(THEME_IDS);

const aliasKey = (theme: string) => theme.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
const aliases = new Map<string, ThemeId>();
for (const theme of TAXONOMY) {
  for (const alias of [theme.id, theme.label, ...theme.aliases]) {
    const key = aliasKey(alias);
    if (aliases.has(key) && aliases.get(key) !== theme.id) throw new Error("Alias duplicado na taxonomia.");
    aliases.set(key, theme.id);
  }
}

export function normalizeTheme(theme: string): ThemeId | undefined { return aliases.get(aliasKey(theme)); }
export function themeLabel(theme: string): string {
  return TAXONOMY.find(entry => entry.id === (normalizeTheme(theme) ?? "outros"))!.label;
}
export const themeWeightsSchema = z.record(z.string(), z.number().finite());
export function normalizeThemeWeights(weights: Record<string, number>): Partial<Record<ThemeId, number>> {
  themeWeightsSchema.parse(weights);
  const groups = new Map<ThemeId, number[]>();
  for (const [theme, weight] of Object.entries(weights)) {
    const id = normalizeTheme(theme) ?? "outros";
    const values = groups.get(id) ?? [];
    values.push(weight);
    groups.set(id, values);
  }
  return Object.fromEntries([...groups].map(([id, values]) => {
    const sum = values.reduce((total, value) => total + value, 0);
    // Pesos legados são finitos, mas a soma intermediária pode ultrapassar o limite numérico.
    const mean = Number.isFinite(sum) ? sum / values.length : values.reduce((total, value) => total + value / values.length, 0);
    return [id, z.number().finite().parse(mean)];
  }));
}
