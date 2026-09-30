import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!body.industry || !body.role) {
    return new Response("industry and role are required", { status: 400 });
  }

  const id = randomUUID().slice(0, 8);
  const sub = {
    id,
    createdAt: new Date().toISOString(),
    industry: String(body.industry).slice(0, 100),
    role: String(body.role).slice(0, 100),
    localeKey: body.localeKey || "zh-TW|TW|TW:zh-Hant",
    keywordGroups: (Array.isArray(body.keywordGroups) ? body.keywordGroups : [])
      .filter((g) => g && g.query)
      .slice(0, 5)
      .map((g, i) => ({ group: `關鍵詞組${i + 1}`, query: String(g.query).slice(0, 200) })),
    ytChannels: (Array.isArray(body.ytChannels) ? body.ytChannels : []).filter(Boolean).slice(0, 10),
    ytKeywords: (Array.isArray(body.ytKeywords) ? body.ytKeywords : []).filter(Boolean).slice(0, 15),
    coreFields: (Array.isArray(body.coreFields) ? body.coreFields : []).filter(Boolean).slice(0, 3),
  };

  const store = getStore("subscribers");
  await store.setJSON(id, sub);

  return Response.json({ id });
};
