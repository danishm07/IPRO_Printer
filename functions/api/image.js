// GET /api/image?path=proposals/12/ref-1.jpg&pass=...
// Streams a reference image from its proposal branch, so it still works when the repo is private.
import { fail, repoParts } from "../../lib/studio.js";

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const path = url.searchParams.get("path") || "";
  const match = /^proposals\/(\d+)\/[A-Za-z0-9._-]+\.(jpg|png|webp)$/.exec(path);
  if (!match) {
    return fail("Bad image path");
  }
  const repo = repoParts(env);
  const headers = {
    authorization: "Bearer " + env.GITHUB_TOKEN,
    accept: "application/vnd.github.raw+json",
    "user-agent": "ipro-studio"
  };
  const api = "https://api.github.com/repos/" + repo.owner + "/" + repo.name + "/contents/" + path;
  // The image is on the proposal branch while it is open, and on main once merged.
  for (const ref of ["proposal-" + match[1], "main"]) {
    const res = await fetch(api + "?ref=" + ref, { headers: headers });
    if (res.ok) {
      const types = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
      return new Response(res.body, {
        headers: { "content-type": types[match[2]], "cache-control": "private, max-age=86400" }
      });
    }
  }
  return fail("Image not found", 404);
}
