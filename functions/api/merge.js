// POST /api/merge  { number, action: "merge" | "close" }   (admin passcode in x-studio-admin)
// merge: squash-merges the proposal's pull request into main, which updates the live viewer.
// close: closes the proposal without merging.
import { json, fail, gh, repoParts, isAdmin } from "../../lib/studio.js";

export async function onRequestPost(context) {
  const env = context.env;
  if (!isAdmin(context.request, env)) {
    return fail("Only the owner can do this", 403);
  }
  const input = await context.request.json();
  const number = parseInt(input.number, 10);
  const action = input.action === "close" ? "close" : "merge";
  if (!number) {
    return fail("Missing proposal number");
  }

  const repo = repoParts(env);
  const base = "/repos/" + repo.owner + "/" + repo.name;
  const branch = "proposal-" + number;
  const pulls = await gh(env, "GET", base + "/pulls?state=open&head=" + repo.owner + ":" + branch);
  const pull = pulls.length ? pulls[0] : null;

  if (action === "close") {
    if (pull) {
      await gh(env, "PATCH", base + "/pulls/" + pull.number, { state: "closed" });
    }
    await gh(env, "PATCH", base + "/issues/" + number, { state: "closed", state_reason: "not_planned" });
    return json({ ok: true });
  }

  if (!pull) {
    return fail("This proposal has no finished version to merge yet");
  }
  try {
    await gh(env, "PUT", base + "/pulls/" + pull.number + "/merge", {
      merge_method: "squash",
      commit_title: pull.title
    });
  } catch (err) {
    if (err.status === 405 || err.status === 409) {
      return fail("This proposal clashes with a change merged earlier. Use \"Change it\" and ask to update it to the latest version, then merge again.", 409);
    }
    throw err;
  }
  // The pull request says "Closes #N", so the issue closes itself. Remove the branch to stop its preview.
  try {
    await gh(env, "DELETE", base + "/git/refs/heads/" + branch);
  } catch (err) {
    // not important if it fails
  }
  return json({ ok: true });
}
