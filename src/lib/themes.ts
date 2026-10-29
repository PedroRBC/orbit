import type { OrbitDB } from "../db/index";
import { getProfile } from "./store";
import { listThemes, MAX_THEMES, resolveTheme, themeKey, themeSlug, themeWeightsSchema, validThemeLabel, type ThemeRow } from "./taxonomy";

export type NewTheme = { label: string; aliases?: string[] };
type Proposal = { rawId: string; label: string; aliases: string[]; createdAt: number; position: number };
type ProposalGroup = { proposals: Proposal[]; keys: Set<string> };
const keysOf = (theme: ThemeRow) => [theme.id, theme.label, ...theme.aliases].map(themeKey);
function uniqueAliases(values: string[], blocked: Set<string>): string[] {
  const seen = new Set(blocked);
  return values.filter(value => { const key = themeKey(value); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
const validLabel = (label: string) => validThemeLabel(label) && !!themeSlug(label);
function resolveProposal(themes: ThemeRow[], proposal: NewTheme): string | undefined {
  const labelKey = themeKey(proposal.label);
  const byLabel = themes.find(theme => keysOf(theme).includes(labelKey));
  if (byLabel) return byLabel.id;
  const aliasKeys = (proposal.aliases ?? []).map(themeKey);
  const matches = themes.filter(theme => theme.origin === "ai" && keysOf(theme).some(key => aliasKeys.includes(key)));
  return matches.length === 1 ? matches[0].id : undefined;
}

// As escritas são chamadas dentro da transação IMMEDIATE com lease do chamador.
export function applyThemeProposal(db: OrbitDB, rawId: string, proposal: NewTheme): string | null {
  const eligible = db.$client.prepare(`SELECT 1 FROM raw_items r LEFT JOIN processed_items p ON p.rawId = r.id
    WHERE r.id = ? AND r.platform <> 'news' AND coalesce(p.isSpam, 0) = 0`).get(rawId);
  if (!eligible) return null;
  const label = proposal.label.trim();
  const aliases = (proposal.aliases ?? []).slice(0, 8).map(alias => alias.trim());
  const themes = listThemes(db);
  const resolved = resolveProposal(themes, { label, aliases });
  if (resolved) return resolved;
  if (!validLabel(label)) return null;
  const allowed = uniqueAliases(aliases, new Set(themes.flatMap(keysOf)));
  db.$client.prepare(`INSERT INTO theme_proposals (raw_id, label, label_key, aliases, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(raw_id) DO NOTHING`).run(rawId, label, themeKey(label), JSON.stringify(allowed), Date.now());
  return null;
}

function proposalGroups(db: OrbitDB): ProposalGroup[] {
  const blocked = new Set(listThemes(db).flatMap(keysOf));
  const rows = db.$client.prepare(`SELECT t.raw_id AS rawId, t.label, t.aliases, t.created_at AS createdAt, t.rowid AS position
    FROM theme_proposals t JOIN raw_items r ON r.id = t.raw_id JOIN processed_items p ON p.rawId = r.id
    WHERE r.platform <> 'news' AND p.isSpam = 0 ORDER BY t.created_at, t.rowid`).all() as (Omit<Proposal, "aliases"> & { aliases: string })[];
  const groups = new Set<ProposalGroup>();
  const byKey = new Map<string, ProposalGroup>();
  for (const row of rows) {
    if (!validLabel(row.label)) continue;
    const proposal = { ...row, aliases: uniqueAliases(JSON.parse(row.aliases) as string[], blocked) };
    const keys = [proposal.label, ...proposal.aliases].map(themeKey);
    const connected = new Set(keys.flatMap(key => { const group = byKey.get(key); return group ? [group] : []; }));
    const group = connected.values().next().value ?? { proposals: [], keys: new Set<string>() };
    for (const other of connected) {
      if (other === group) continue;
      group.proposals.push(...other.proposals);
      for (const key of other.keys) { group.keys.add(key); byKey.set(key, group); }
      groups.delete(other);
    }
    group.proposals.push(proposal);
    for (const key of keys) { group.keys.add(key); byKey.set(key, group); }
    groups.add(group);
  }
  return [...groups].map(group => ({ ...group, proposals: group.proposals.sort((a, b) => a.createdAt - b.createdAt || a.position - b.position) }));
}

function groupLabel(group: ProposalGroup): string {
  const counts = new Map<string, { label: string; count: number }>();
  for (const proposal of group.proposals) {
    const key = themeKey(proposal.label);
    const value = counts.get(key) ?? { label: proposal.label, count: 0 };
    value.count++;
    counts.set(key, value);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0].label;
}

export function pendingProposalGroups(db: OrbitDB, limit = 20): { label: string; count: number }[] {
  return proposalGroups(db).sort((a, b) => {
    const lastA = a.proposals.at(-1)!; const lastB = b.proposals.at(-1)!;
    return lastB.createdAt - lastA.createdAt || lastB.position - lastA.position;
  }).slice(0, Math.max(0, Math.min(20, limit))).map(group => ({ label: groupLabel(group), count: group.proposals.length }));
}

function reassign(db: OrbitDB, rawId: string, intoId: string, reason: "proposal" | "legacy_label" | "merge", now: number): number {
  const from = db.$client.prepare("SELECT theme FROM processed_items WHERE rawId = ?").pluck().get(rawId) as string | undefined;
  if (!from || from === intoId) return 0;
  const moved = db.$client.prepare("UPDATE processed_items SET theme = ? WHERE rawId = ?").run(intoId, rawId).changes;
  db.$client.prepare("INSERT INTO taxonomy_reassignments (raw_id, from_theme, to_theme, reason, at) VALUES (?, ?, ?, ?, ?)").run(rawId, from, intoId, reason, now);
  return moved;
}

export function promoteProposals(db: OrbitDB, now = Date.now()): string[] {
  const created: string[] = [];
  for (const group of proposalGroups(db)) {
    const themes = listThemes(db);
    const label = groupLabel(group);
    const resolved = resolveProposal(themes, { label, aliases: group.proposals.flatMap(proposal => [proposal.label, ...proposal.aliases]) });
    if (resolved) {
      for (const proposal of group.proposals) {
        reassign(db, proposal.rawId, resolved, "proposal", now);
        db.$client.prepare("DELETE FROM theme_proposals WHERE raw_id = ?").run(proposal.rawId);
      }
      continue;
    }
    if (group.proposals.length < 3 || themes.length >= MAX_THEMES) continue;
    const slug = themeSlug(label);
    let id = slug;
    for (let suffix = 2; resolveTheme(db, id); suffix++) {
      const ending = `-${suffix}`;
      id = slug.slice(0, 40 - ending.length).replace(/-+$/, "") + ending;
    }
    const blocked = new Set([...themes.flatMap(keysOf), themeKey(label), themeKey(id)]);
    const aliases = uniqueAliases(group.proposals.flatMap(proposal => [proposal.label, ...proposal.aliases]), blocked);
    db.$client.prepare("INSERT INTO taxonomy_themes (id, label, origin, aliases, created_at) VALUES (?, ?, 'ai', ?, ?)").run(id, label, JSON.stringify(aliases), now);
    for (const proposal of group.proposals) reassign(db, proposal.rawId, id, "proposal", now);
    const legacyKeys = new Set([label, ...aliases].map(themeKey));
    const legacy = db.$client.prepare(`SELECT p.rawId, a.original_theme AS originalTheme FROM taxonomy_item_audit a
      JOIN processed_items p ON p.rawId = a.raw_id WHERE p.theme = a.theme_id AND p.theme <> ?`).all(id) as { rawId: string; originalTheme: string }[];
    for (const item of legacy) if (legacyKeys.has(themeKey(item.originalTheme))) reassign(db, item.rawId, id, "legacy_label", now);
    for (const proposal of group.proposals) db.$client.prepare("DELETE FROM theme_proposals WHERE raw_id = ?").run(proposal.rawId);
    created.push(id);
  }
  return created;
}

export function mergeTheme(db: OrbitDB, fromId: string, intoId: string): number {
  const themes = listThemes(db);
  const from = themes.find(theme => theme.id === fromId);
  if (from?.origin !== "ai") throw new Error("Somente temas criados automaticamente podem ser juntados.");
  const into = themes.find(theme => theme.id === intoId);
  if (!into || fromId === intoId) throw new Error("Escolha outro tema existente como destino.");
  const now = Date.now();
  const items = db.$client.prepare("SELECT rawId FROM processed_items WHERE theme = ?").all(fromId) as { rawId: string }[];
  const moved = items.reduce((count, item) => count + reassign(db, item.rawId, intoId, "merge", now), 0);
  const profile = getProfile(db);
  if (profile) {
    const weights = themeWeightsSchema.parse(JSON.parse(profile.weights));
    if (Object.hasOwn(weights, fromId)) {
      const fromWeight = weights[fromId]; const intoWeight = Object.hasOwn(weights, intoId) ? weights[intoId] : undefined;
      const sum = fromWeight + (intoWeight ?? 0);
      weights[intoId] = intoWeight === undefined ? fromWeight : Number.isFinite(sum) ? sum / 2 : fromWeight / 2 + intoWeight / 2;
      delete weights[fromId];
      db.$client.prepare("UPDATE interest_profile SET weights = ?, updatedAt = ? WHERE id = ?").run(JSON.stringify(weights), now, profile.id);
    }
  }
  const blocked = new Set([...themes.filter(theme => theme.id !== fromId && theme.id !== intoId).flatMap(keysOf), themeKey(into.id), themeKey(into.label)]);
  const aliases = uniqueAliases([...into.aliases, from.label, ...from.aliases], blocked);
  db.$client.prepare("UPDATE taxonomy_themes SET aliases = ? WHERE id = ?").run(JSON.stringify(aliases), intoId);
  db.$client.prepare("DELETE FROM taxonomy_themes WHERE id = ?").run(fromId);
  return moved;
}
