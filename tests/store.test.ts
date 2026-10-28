import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/index";
import { sources, sourceItems, rawItems } from "../src/db/schema";
import { enqueueCollection, claimRun, saveRawItems, reserveUsage, settleUsage, dailyUsage, activeItemCondition } from "../src/lib/store";

const databases: ReturnType<typeof openDatabase>[] = [];
function database() { const db = openDatabase(":memory:"); databases.push(db); return db; }
afterEach(() => { for (const db of databases.splice(0)) db.$client.close(); });

describe("persistência e fila", () => {
  it("enfileira uma única coleta enquanto há execução pendente", () => {
    const db = database();
    const first = enqueueCollection(db);
    expect(enqueueCollection(db)).toBe(first);
    expect(claimRun(db)?.id).toBe(first);
    expect(claimRun(db)).toBeUndefined();
    expect(enqueueCollection(db)).toBe(first);
  });
  it("mantém vínculo com todas as fontes sem duplicar o mesmo vídeo", () => {
    const db = database();
    const first = db.insert(sources).values({ channelId: "rss-id", name: "RSS" }).returning().get();
    const second = db.insert(sources).values({ channelId: "https://www.youtube.com/", name: "Home", kind: "youtube_home" }).returning().get();
    const item = { platform: "youtube" as const, externalId: "abcdefghijk", title: "Aula", text: "Descrição", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: null, durationSeconds: null };
    saveRawItems(db, first.id, [item]); saveRawItems(db, second.id, [item]);
    expect(db.select().from(rawItems).all()).toHaveLength(1);
    expect(db.select().from(sourceItems).all()).toHaveLength(2);
    db.update(sources).set({ enabled: false }).where(eq(sources.id, first.id)).run();
    expect(db.select().from(rawItems).where(activeItemCondition()).all()).toHaveLength(1);
    db.update(sources).set({ enabled: false }).where(eq(sources.id, second.id)).run();
    expect(db.select().from(rawItems).where(activeItemCondition()).all()).toHaveLength(0);
  });
  it("deduplica o permalink quando API e DOM identificam um repost por IDs diferentes", () => {
    const db = database();
    const source = db.insert(sources).values({ channelId: "https://app.valete.org.br/", name: "Valete", kind: "valete_feed", platform: "valete" }).returning().get();
    const item = { platform: "valete" as const, externalId: "repost-id", title: "Post", text: "Texto visível", author: "Autor", url: "https://app.valete.org.br/p/titulo/repost-id", thumbnail: null, publishedAt: null, durationSeconds: null, evidence: "valete_dom" as const };
    expect(saveRawItems(db, source.id, [item])).toBe(1);
    expect(saveRawItems(db, source.id, [{ ...item, externalId: "original-id", evidence: "valete_feed" }])).toBe(0);
    expect(db.select().from(rawItems).all()).toHaveLength(1);
  });
  it("persiste itens repetidos uma única vez", () => {
    const db = database();
    const source = db.insert(sources).values({ channelId: "UC_x5XG1OV2P6uZZ5FSM9Ttw", name: "Ciência" }).returning().get();
    const item = { platform: "youtube" as const, externalId: "abcdefghijk", title: "Aula", text: "Descrição", author: "Canal", url: "https://www.youtube.com/watch?v=abcdefghijk", thumbnail: null, publishedAt: null, durationSeconds: null };
    expect(saveRawItems(db, source.id, [item, item])).toBe(1);
    expect(saveRawItems(db, source.id, [item])).toBe(0);
    expect(db.select().from(rawItems).all()).toHaveLength(1);
  });
});

describe("orçamento conservador", () => {
  it("reserva antes de chamar e bloqueia ultrapassagem do teto", () => {
    const db = database();
    const id = reserveUsage(db, 600, null, 1000, null);
    expect(id).toBeTypeOf("number");
    expect(() => reserveUsage(db, 401, null, 1000, null)).toThrow(/limite|teto/i);
    expect(dailyUsage(db).tokens).toBe(600);
    settleUsage(db, id, 120, null);
    expect(dailyUsage(db).tokens).toBe(120);
    expect(reserveUsage(db, 880, null, 1000, null)).toBeTypeOf("number");
  });
  it("mantém reservas de resultado desconhecido e bloqueia teto em dinheiro", () => {
    const db = database();
    reserveUsage(db, 300, 0.2, 1000, 0.25);
    expect(() => reserveUsage(db, 50, 0.1, 1000, 0.25)).toThrow();
    expect(dailyUsage(db)).toMatchObject({ tokens: 300, cost: 0.2, reserved: 1 });
  });
});
