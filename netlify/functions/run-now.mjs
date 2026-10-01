import { getStore } from "@netlify/blobs";
import { collectItems, analyzeWithGemini } from "./_lib/intel.mjs";

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const id = body.id;
  if (!id) return new Response("Missing id", { status: 400 });

  const subscribersStore = getStore("subscribers");
  const intelStore = getStore("intel");

  const sub = await subscribersStore.get(id, { type: "json" });
  if (!sub) return new Response("Not found", { status: 404 });

  const items = await collectItems(sub, { verify: false });
  const summary = await analyzeWithGemini(sub, items, { maxAttempts: 1 });

  const result = {
    generatedAt: new Date().toISOString(),
    entries: items,
    summary,
  };
  await intelStore.setJSON(`${id}/latest.json`, result);

  return Response.json(result);
};
