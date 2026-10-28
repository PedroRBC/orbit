import type Sqlite from "better-sqlite3";
import { normalizeTheme, normalizeThemeWeights, TAXONOMY, themeWeightsSchema } from "../lib/taxonomy";

type Counts = { items: number; profiles: number; fallbackItems: number; fallbackWeights: number };
export type TaxonomyConsolidation = Counts & { version: 1; applied: boolean };

export function consolidateTaxonomy(db: { $client: Sqlite.Database }): TaxonomyConsolidation {
  const client = db.$client;
  return client.transaction((): TaxonomyConsolidation => {
    client.exec(`CREATE TABLE IF NOT EXISTS taxonomy_consolidations (
      version INTEGER PRIMARY KEY CHECK (version = 1), completed_at INTEGER NOT NULL,
      item_count INTEGER NOT NULL, profile_count INTEGER NOT NULL,
      fallback_item_count INTEGER NOT NULL, fallback_weight_count INTEGER NOT NULL
    )`);
    const previous = client.prepare("SELECT item_count AS items, profile_count AS profiles, fallback_item_count AS fallbackItems, fallback_weight_count AS fallbackWeights FROM taxonomy_consolidations WHERE version = 1").get() as Counts | undefined;
    if (previous) return { version: 1, applied: false, ...previous };

    client.exec(`
      CREATE TABLE taxonomy_themes (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL UNIQUE);
      CREATE TABLE taxonomy_item_audit (
        raw_id TEXT PRIMARY KEY NOT NULL REFERENCES raw_items(id), original_theme TEXT NOT NULL,
        theme_id TEXT NOT NULL REFERENCES taxonomy_themes(id),
        mapping TEXT NOT NULL CHECK (mapping IN ('canonical', 'alias', 'fallback')), consolidated_at INTEGER NOT NULL
      );
      CREATE TABLE taxonomy_profile_audit (
        profile_id INTEGER PRIMARY KEY REFERENCES interest_profile(id), original_weights TEXT NOT NULL,
        mapped_weights TEXT NOT NULL, consolidated_at INTEGER NOT NULL
      );
      CREATE TABLE taxonomy_weight_audit (
        profile_id INTEGER NOT NULL REFERENCES taxonomy_profile_audit(profile_id), original_theme TEXT NOT NULL,
        original_weight REAL NOT NULL, theme_id TEXT NOT NULL REFERENCES taxonomy_themes(id), mapped_weight REAL NOT NULL,
        mapping TEXT NOT NULL CHECK (mapping IN ('canonical', 'alias', 'fallback')),
        PRIMARY KEY (profile_id, original_theme)
      );
    `);
    const insertTheme = client.prepare("INSERT INTO taxonomy_themes (id, label) VALUES (?, ?)");
    for (const theme of TAXONOMY) insertTheme.run(theme.id, theme.label);
    const now = Date.now();
    const items = client.prepare("SELECT rawId, theme FROM processed_items ORDER BY rawId").all() as { rawId: string; theme: string }[];
    const profiles = client.prepare("SELECT id, weights FROM interest_profile ORDER BY id").all() as { id: number; weights: string }[];
    let fallbackItems = 0;
    let fallbackWeights = 0;
    const insertItemAudit = client.prepare("INSERT INTO taxonomy_item_audit (raw_id, original_theme, theme_id, mapping, consolidated_at) VALUES (?, ?, ?, ?, ?)");
    const updateItem = client.prepare("UPDATE processed_items SET theme = ? WHERE rawId = ?");
    for (const item of items) {
      const normalized = normalizeTheme(item.theme);
      const id = normalized ?? "outros";
      if (!normalized) fallbackItems++;
      insertItemAudit.run(item.rawId, item.theme, id, item.theme === id ? "canonical" : normalized ? "alias" : "fallback", now);
      if (updateItem.run(id, item.rawId).changes !== 1) throw new Error("Não foi possível consolidar o tema do item.");
    }
    const insertProfileAudit = client.prepare("INSERT INTO taxonomy_profile_audit (profile_id, original_weights, mapped_weights, consolidated_at) VALUES (?, ?, ?, ?)");
    const insertWeightAudit = client.prepare("INSERT INTO taxonomy_weight_audit (profile_id, original_theme, original_weight, theme_id, mapped_weight, mapping) VALUES (?, ?, ?, ?, ?, ?)");
    const updateProfile = client.prepare("UPDATE interest_profile SET weights = ? WHERE id = ?");
    const duplicateWeightKeys = client.prepare("SELECT count(*) <> count(DISTINCT key) FROM json_each(?)").pluck();
    for (const profile of profiles) {
      if (duplicateWeightKeys.get(profile.weights)) throw new Error("Pesos legados contêm temas duplicados; consolidação cancelada.");
      const weights = themeWeightsSchema.parse(JSON.parse(profile.weights));
      const mapped = normalizeThemeWeights(weights);
      const serialized = JSON.stringify(mapped);
      insertProfileAudit.run(profile.id, profile.weights, serialized, now);
      for (const [theme, weight] of Object.entries(weights)) {
        const normalized = normalizeTheme(theme);
        const id = normalized ?? "outros";
        if (!normalized) fallbackWeights++;
        insertWeightAudit.run(profile.id, theme, weight, id, mapped[id]!, theme === id ? "canonical" : normalized ? "alias" : "fallback");
      }
      if (updateProfile.run(serialized, profile.id).changes !== 1) throw new Error("Não foi possível consolidar os pesos do perfil.");
    }
    const invalid = client.prepare(`SELECT count(*) FROM processed_items p LEFT JOIN taxonomy_item_audit a ON a.raw_id = p.rawId
      WHERE a.raw_id IS NULL OR a.theme_id <> p.theme OR NOT EXISTS (SELECT 1 FROM taxonomy_themes t WHERE t.id = p.theme)`).pluck().get();
    if (invalid !== 0) throw new Error("A verificação da taxonomia falhou; consolidação cancelada.");

    const validateWeights = `BEGIN
      SELECT CASE WHEN json_valid(NEW.weights) = 0 THEN RAISE(ABORT, 'Pesos inválidos para a taxonomia.') END;
      SELECT CASE WHEN json_type(NEW.weights) <> 'object' OR EXISTS (
        SELECT 1 FROM json_each(NEW.weights) w WHERE w.key NOT IN (SELECT id FROM taxonomy_themes)
          OR w.type NOT IN ('integer', 'real') OR w.value NOT BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308
      ) OR (SELECT count(*) FROM json_each(NEW.weights)) <> (SELECT count(DISTINCT key) FROM json_each(NEW.weights))
      THEN RAISE(ABORT, 'Pesos fora da taxonomia.') END;
    END;`;
    client.exec(`
      CREATE TRIGGER taxonomy_theme_insert BEFORE INSERT ON processed_items
      WHEN NOT EXISTS (SELECT 1 FROM taxonomy_themes WHERE id = NEW.theme)
      BEGIN SELECT RAISE(ABORT, 'Tema fora da taxonomia.'); END;
      CREATE TRIGGER taxonomy_theme_update BEFORE UPDATE OF theme ON processed_items
      WHEN NOT EXISTS (SELECT 1 FROM taxonomy_themes WHERE id = NEW.theme)
      BEGIN SELECT RAISE(ABORT, 'Tema fora da taxonomia.'); END;
      CREATE TRIGGER taxonomy_item_insert_audit AFTER INSERT ON processed_items BEGIN
        INSERT OR IGNORE INTO taxonomy_item_audit (raw_id, original_theme, theme_id, mapping, consolidated_at)
        VALUES (NEW.rawId, NEW.theme, NEW.theme, 'canonical', unixepoch() * 1000);
      END;
      CREATE TRIGGER taxonomy_weights_insert BEFORE INSERT ON interest_profile ${validateWeights}
      CREATE TRIGGER taxonomy_weights_update BEFORE UPDATE OF weights ON interest_profile ${validateWeights}
      CREATE TRIGGER taxonomy_catalog_insert BEFORE INSERT ON taxonomy_themes
      BEGIN SELECT RAISE(ABORT, 'O catálogo da taxonomia é fixo.'); END;
      CREATE TRIGGER taxonomy_catalog_update BEFORE UPDATE ON taxonomy_themes
      BEGIN SELECT RAISE(ABORT, 'O catálogo da taxonomia é fixo.'); END;
      CREATE TRIGGER taxonomy_catalog_delete BEFORE DELETE ON taxonomy_themes
      BEGIN SELECT RAISE(ABORT, 'O catálogo da taxonomia é fixo.'); END;
    `);
    const counts = { items: items.length, profiles: profiles.length, fallbackItems, fallbackWeights };
    client.prepare("INSERT INTO taxonomy_consolidations (version, completed_at, item_count, profile_count, fallback_item_count, fallback_weight_count) VALUES (1, ?, ?, ?, ?, ?)").run(now, counts.items, counts.profiles, fallbackItems, fallbackWeights);
    return { version: 1, applied: true, ...counts };
  }).immediate();
}
