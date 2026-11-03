// POST /api/vote  { number, name, vote: "approve" | "reject" | "none" }
// Votes live in a hidden marker in the issue body, one per name.
import { json, fail, gh, repoParts, cleanName, readMarker, writeMarker } from "../../lib/studio.js";

export async function onRequestPost(context) {
  const env = context.env;
  const input = await context.request.json();
  const number = parseInt(input.number, 10);
  const name = cleanName(input.name);
  const vote = String(input.vote || "");
  if (!number || !name) {
    return fail("Missing proposal or name");
  }
  if (vote !== "approve" && vote !== "reject" && vote !== "none") {
    return fail("Unknown vote");
  }

  const repo = repoParts(env);
  const path = "/repos/" + repo.owner + "/" + repo.name + "/issues/" + number;
  const issue = await gh(env, "GET", path);
  const votes = readMarker(issue.body, "votes");
  const key = name.toLowerCase();
  if (vote === "none") {
    delete votes[key];
  } else {
    votes[key] = { name: name, vote: vote };
  }
  const body = writeMarker(issue.body, "votes", votes);
  await gh(env, "PATCH", path, { body: body });
  return json({ ok: true });
}
