// POST /api/propose  { name, title, text, image }
// Opens an issue for the idea, stores the image on the proposal branch, then adds the
// "proposal" label, which starts the build workflow.
import { json, fail, gh, repoParts, cleanName, cleanText, imageBase64, saveImage, writeMarker, busyProposalFor } from "../../lib/studio.js";

async function ensureLabel(env, name, color) {
  const repo = repoParts(env);
  try {
    await gh(env, "POST", "/repos/" + repo.owner + "/" + repo.name + "/labels", { name: name, color: color });
  } catch (err) {
    // 422 means it already exists
    if (err.status !== 422) {
      throw err;
    }
  }
}

export async function onRequestPost(context) {
  const env = context.env;
  const input = await context.request.json();
  const name = cleanName(input.name);
  const text = cleanText(input.text, 4000);
  let title = cleanText(input.title, 80);
  if (!name) {
    return fail("Please add your name");
  }
  if (text.length < 5) {
    return fail("Please describe the change");
  }
  if (!title) {
    title = text.split("\n")[0].slice(0, 70);
  }
  let image = null;
  if (input.image) {
    image = imageBase64(input.image);
    if (!image) {
      return fail("That image could not be read. Try a JPG or PNG under 3 MB.");
    }
  }

  const busy = await busyProposalFor(env, name);
  if (busy) {
    return fail("Your proposal #" + busy + " is still building. Wait for it to finish or cancel it first.", 409);
  }

  const repo = repoParts(env);
  const base = "/repos/" + repo.owner + "/" + repo.name;
  const meta = { name: name };
  let body = writeMarker("", "meta", meta) + "\n" + text + "\n";
  body = writeMarker(body, "votes", {});
  const issue = await gh(env, "POST", base + "/issues", { title: title, body: body });

  if (image) {
    const path = await saveImage(env, issue.number, image, 1);
    meta.image = path;
    const updated = writeMarker(body, "meta", meta);
    await gh(env, "PATCH", base + "/issues/" + issue.number, { body: updated });
  }

  await ensureLabel(env, "proposal", "5319E7");
  await gh(env, "POST", base + "/issues/" + issue.number + "/labels", { labels: ["proposal"] });
  return json({ number: issue.number });
}
