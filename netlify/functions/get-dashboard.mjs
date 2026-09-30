import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const subscribersStore = getStore("subscribers");
  const intelStore = getStore("intel");

  const sub = await subscribersStore.get(id, { type: "json" });
  if (!sub) return new Response("Not found", { status: 404 });

  const intel = await intelStore.get(`${id}/latest.json`, { type: "json" });

  return Response.json({ subscriber: sub, intel: intel || null });
};
