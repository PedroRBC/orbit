import { describe, it, expect } from "vitest";
import { normalizeChannel, parseYouTubeFeed } from "../src/collectors/youtube";

const channel = "UC_x5XG1OV2P6uZZ5FSM9Ttw";
export const feed = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom"><title>Canal de teste</title><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channel}</yt:channelId><title>Uma aula de ciência</title><link rel="alternate" href="https://www.youtube.com/watch?v=abcdefghijk"/><author><name>Canal de teste</name></author><published>2026-10-27T10:00:00Z</published><media:group><media:description>Descrição da aula.</media:description><media:thumbnail url="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg"/></media:group></entry></feed>`;

describe("YouTube RSS", () => {
  it("aceita IDs e URLs de canal sem permitir hosts arbitrários", () => {
    expect(normalizeChannel(channel)).toBe(channel);
    expect(normalizeChannel(`https://www.youtube.com/channel/${channel}`)).toBe(channel);
    expect(() => normalizeChannel(`https://evil.example/channel/${channel}`)).toThrow();
    expect(() => normalizeChannel("https://youtube.com/@qualquer" )).toThrow(/ID|channel/);
    expect(() => normalizeChannel(`https://youtube.com/channel/${channel}/extra`)).toThrow();
  });
  it("normaliza metadados sem baixar mídia ou inventar duração", async () => {
    const items = await parseYouTubeFeed(feed, channel);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "abcdefghijk", title: "Uma aula de ciência", text: "Descrição da aula.", url: "https://www.youtube.com/watch?v=abcdefghijk", durationSeconds: null });
  });
  it("rejeita HTML e IDs de vídeo inválidos", async () => {
    await expect(parseYouTubeFeed("<html>Faça login</html>", channel)).rejects.toThrow();
    expect(await parseYouTubeFeed(feed.replaceAll("abcdefghijk", "invalid"), channel)).toEqual([]);
  });
});
