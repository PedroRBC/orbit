import { z } from "zod";
import type { OrbitDB } from "../db";

export const LEGACY_TAXONOMY = [
  { id: "politica-interna", label: "Política interna", description: "Governo, eleições, partidos e instituições do Brasil.", aliases: ["Política interna (Brasil)", "Política brasileira", "Política nacional", "Brazilian politics", "Domestic politics", "Eleições", "Eleições brasileiras", "Eleições e votos anulados", "Renan Santos", "Renan Santos e Dilma", "Renan Santos e eleições", "Renan Santos e política", "Política e Renan Santos", "Votos nulos", "Congresso", "Governo brasileiro"] },
  { id: "politica-externa", label: "Política externa", description: "Relações entre países, diplomacia e geopolítica. Mencionar outro país, por si só, não define este tema.", aliases: ["Política externa (relações internacionais)", "Relações internacionais", "Política internacional", "Geopolítica", "Diplomacia", "Foreign policy", "International politics", "International relations", "Geopolitics", "Internacionalização e política"] },
  { id: "tecnologia", label: "Tecnologia", description: "IA, programação, software, hardware, redes e suporte técnico, sem subdivisões.", aliases: ["Technology", "Tech", "IA", "Inteligência artificial", "Artificial intelligence", "IA aplicada a código", "Programação", "Programação e auditoria", "Programming", "Desenvolvimento de software", "Software", "Hardware", "Hardware e desempenho de PC", "Processadores", "Computadores", "Mensageria descentralizada", "Suporte técnico", "Segurança digital", "Cibersegurança"] },
  { id: "ciencia-saude", label: "Ciência e saúde", description: "Pesquisa científica, meio ambiente, medicina e saúde.", aliases: ["Ciência", "Science", "Saúde", "Health", "Science and health", "Medicina", "Pesquisa científica", "Biologia", "Astronomia", "Física", "Meio ambiente"] },
  { id: "economia-trabalho", label: "Economia e trabalho", description: "Economia, finanças, negócios, emprego e carreira.", aliases: ["Economia", "Economy", "Economics", "Economy and work", "Trabalho", "Work", "Carreira", "Relato de trabalho", "Relato profissional", "Trabalho noturno", "Finanças", "Finance", "Investimentos", "Mercado financeiro", "Dívida dos EUA", "Ações e Zona Franca de Manaus", "Negócios", "Empreendedorismo"] },
  { id: "sociedade-cotidiano", label: "Sociedade e cotidiano", description: "Vida cotidiana, comportamento, educação, mobilidade, automóveis e animais.", aliases: ["Sociedade", "Society", "Society and daily life", "Cotidiano", "Daily life", "Comportamento", "Educação", "Segurança pública", "Mobilidade", "Automóveis", "Aluguel de carros", "Coleção de carros", "Oficina automotiva", "Carros", "Cars", "Animais", "Animais de estimação", "Animals", "Pets", "Relacionamentos"] },
  { id: "cultura-lazer", label: "Cultura e lazer", description: "Artes, jogos, entretenimento, esportes, viagens e lazer.", aliases: ["Cultura", "Culture", "Culture and leisure", "Lazer", "Entretenimento", "Entertainment", "Jogos", "Games", "Gaming", "Cultura e jogos", "Mercado de jogos", "Música", "Cinema", "Filmes", "Filme ligado a Renan", "Séries", "Literatura", "Arte", "Humor", "Reação humorística", "Memes", "Esportes", "Sports", "Turismo", "Viagens", "Gastronomia"] },
  { id: "outros", label: "Outros", description: "Conteúdo sem contexto suficiente ou que não cabe com segurança nos demais temas.", aliases: ["Other", "Others", "Miscellaneous", "Sem contexto", "Não classificado"] },
] as const;
// Compatibilidade dos consumidores estáticos até migrarem para o catálogo do banco.
export const TAXONOMY = LEGACY_TAXONOMY;
export type ThemeId = typeof LEGACY_TAXONOMY[number]["id"];
export const THEME_IDS = LEGACY_TAXONOMY.map(theme => theme.id);
export const themeSchema = z.enum(THEME_IDS);

const aliasKey = (theme: string) => theme.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim();
const aliases = new Map<string, ThemeId>();
for (const theme of LEGACY_TAXONOMY) {
  for (const alias of [theme.id, theme.label, ...theme.aliases]) {
    const key = aliasKey(alias);
    if (aliases.has(key) && aliases.get(key) !== theme.id) throw new Error("Alias duplicado na taxonomia.");
    aliases.set(key, theme.id);
  }
}

export function legacyNormalizeTheme(theme: string): ThemeId | undefined { return aliases.get(aliasKey(theme)); }
export const normalizeTheme = legacyNormalizeTheme;
export function themeLabel(theme: string): string {
  return TAXONOMY.find(entry => entry.id === (normalizeTheme(theme) ?? "outros"))!.label;
}
export const themeWeightsSchema = z.record(z.string(), z.number().finite());
export function legacyNormalizeThemeWeights(weights: Record<string, number>): Partial<Record<ThemeId, number>> {
  themeWeightsSchema.parse(weights);
  const groups = new Map<ThemeId, number[]>();
  for (const [theme, weight] of Object.entries(weights)) {
    const id = legacyNormalizeTheme(theme) ?? "outros";
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
export const normalizeThemeWeights = legacyNormalizeThemeWeights;

export const SEED_THEMES: readonly { id: string; label: string; description: string }[] = LEGACY_TAXONOMY.map(({ id, label, description }) => ({
  id,
  label: id === "politica-interna" ? "Política do Brasil" : label,
  description: id === "tecnologia" ? "IA, programação, software, hardware, redes, suporte técnico e inovações no Brasil e no mundo."
    : id === "sociedade-cotidiano" ? "Vida cotidiana, comportamento, educação, mobilidade e animais." : description,
}));
export const SEED_IDS: readonly string[] = SEED_THEMES.map(theme => theme.id);
export const MAX_THEMES = 40;

export function themeKey(text: string): string {
  return aliasKey(text).split(" ").map(word => {
    if (word.length <= 3) return word;
    if (/(oes|aes)$/.test(word)) return word.slice(0, -3) + "ao";
    if (/eis$/.test(word)) return word.slice(0, -3) + "el";
    if (/ais$/.test(word)) return word.slice(0, -3) + "al";
    if (/ns$/.test(word)) return word.slice(0, -2) + "m";
    return word.replace(/s$/, "");
  }).join(" ");
}

export function themeSlug(label: string): string {
  return aliasKey(label).replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
}

export function validThemeLabel(label: string): boolean {
  return label.length >= 2 && label.length <= 40 && label.split(/ +/).length <= 4
    && /^\p{Letter}[\p{Letter}\p{Mark}]*(?:[ -]+\p{Letter}[\p{Letter}\p{Mark}]*)*$/u.test(label);
}

export type ThemeRow = { id: string; label: string; description: string; origin: "seed" | "ai"; aliases: string[]; createdAt: number };

export function listThemes(db: OrbitDB): ThemeRow[] {
  const rows = db.$client.prepare(`SELECT id, label, origin, aliases, created_at AS createdAt FROM taxonomy_themes
    ORDER BY CASE origin WHEN 'seed' THEN 0 ELSE 1 END, created_at, rowid`).all() as (Omit<ThemeRow, "description" | "aliases"> & { aliases: string })[];
  return rows.map(row => ({ ...row, aliases: JSON.parse(row.aliases), description: row.origin === "seed" ? SEED_THEMES.find(seed => seed.id === row.id)!.description : "" }));
}

export function themeLabels(db: OrbitDB): Map<string, string> {
  return new Map(listThemes(db).map(theme => [theme.id, theme.label]));
}

export function resolveTheme(db: OrbitDB, labelOrId: string): string | undefined {
  const key = themeKey(labelOrId);
  return listThemes(db).find(theme => [theme.id, theme.label, ...theme.aliases].some(alias => themeKey(alias) === key))?.id;
}
