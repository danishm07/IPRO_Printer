// POST /api/refine  { number, name, text, image }
// Adds a "/refine" follow-up comment; the workflow rebuilds the same branch with it.
import { json, fail, gh, repoParts, cleanName, cleanText, imageBase64, saveImage, writeMarker } from "../../lib/studio.js";

export async function onRequestPost(context) {
  const env = context.env;
  const input = await context.request.json();
  const number = parseInt(input.number, 10);
  const name = cleanName(input.name);
  const text = cleanText(input.text, 4000);
  if (!number) {
    return fail("Missing proposal number");
  }
  if (!name) {
    return fail("Please add your name");
  }
  if (text.length < 3) {
    return fail("Please describe what to change");
  }

  const repo = repoParts(env);
  const base = "/repos/" + repo.owner + "/" + repo.name;
  const issue = await gh(env, "GET", base + "/issues/" + number);
  if (issue.state !== "open") {
    return fail("This proposal is already closed");
  }

  const meta = { name: name };
  if (input.image) {
    const image = imageBase64(input.image);
    if (!image) {
      return fail("That image could not be read. Try a JPG or PNG under 3 MB.");
    }
    meta.image = await saveImage(env, number, image, Date.now());
  }

  const body = "/refine " + text + "\n<!-- studio:meta " + JSON.stringify(meta) + " -->";
  await gh(env, "POST", base + "/issues/" + number + "/comments", { body: body });
  // A new version is on its way, so earlier votes no longer apply to it.
  const clearedBody = writeMarker(issue.body, "votes", {});
  await gh(env, "PATCH", base + "/issues/" + number, { body: clearedBody });
  return json({ ok: true });
}
