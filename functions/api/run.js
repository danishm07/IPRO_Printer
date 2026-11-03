// POST /api/run  { number, name, action: "cancel" | "rerun" | "remove" }
// cancel: stops the proposal's build that is running or waiting.
// rerun: builds the same request again (after a failed or cancelled build).
// remove: closes the proposal without merging and deletes its branch (its author or the owner).
// Needs the GitHub token to have Actions: read and write.
import { json, fail, gh, repoParts, isBusy, labelNames, isAdmin, readMarker, cleanName } from "../../lib/studio.js";

async function runsFor(env, number) {
  const repo = repoParts(env);
  const base = "/repos/" + repo.owner + "/" + repo.name + "/actions/workflows/studio.yml/runs";
  const found = [];
  for (const status of ["in_progress", "queued", "waiting", "pending"]) {
    const data = await gh(env, "GET", base + "?per_page=30&status=" + status);
    for (const run of data.workflow_runs || []) {
      // The workflow names each run "Proposal #<number>"
      if (run.display_title === "Proposal #" + number) {
        found.push(run.id);
      }
    }
  }
  return found;
}

export async function onRequestPost(context) {
  const env = context.env;
  const input = await context.request.json();
  const number = parseInt(input.number, 10);
  const action = input.action;
  if (!number) {
    return fail("Missing proposal number");
  }
  const repo = repoParts(env);
  const base = "/repos/" + repo.owner + "/" + repo.name;
  const issue = await gh(env, "GET", base + "/issues/" + number);
  if (issue.state !== "open") {
    return fail("This proposal is already closed");
  }
  const labels = labelNames(issue);

  if (action === "cancel") {
    const runs = await runsFor(env, number);
    for (const id of runs) {
      await gh(env, "POST", base + "/actions/runs/" + id + "/cancel");
    }
    if (!runs.length) {
      // Nothing running on GitHub's side, so just clear the "building" state.
      await gh(env, "POST", base + "/issues/" + number + "/labels", { labels: ["cancelled"] });
      try {
        await gh(env, "DELETE", base + "/issues/" + number + "/labels/building");
      } catch (err) {
        // it may not have had the label
      }
    }
    return json({ ok: true });
  }

  if (action === "remove") {
    const meta = readMarker(issue.body, "meta");
    const author = String(meta.name || "").toLowerCase();
    const caller = cleanName(input.name).toLowerCase();
    if (!isAdmin(context.request, env) && (!caller || caller !== author)) {
      return fail("Only the person who suggested this, or the owner, can remove it", 403);
    }
    if (isBusy(labels)) {
      return fail("Cancel the build first, then remove it");
    }
    const branch = "proposal-" + number;
    const pulls = await gh(env, "GET", base + "/pulls?state=open&head=" + repo.owner + ":" + branch);
    for (const pull of pulls) {
      await gh(env, "PATCH", base + "/pulls/" + pull.number, { state: "closed" });
    }
    await gh(env, "PATCH", base + "/issues/" + number, { state: "closed", state_reason: "not_planned" });
    try {
      await gh(env, "DELETE", base + "/git/refs/heads/" + branch);
    } catch (err) {
      // the branch may never have been created
    }
    return json({ ok: true });
  }

  if (action === "rerun") {
    if (isBusy(labels)) {
      return fail("This proposal is already building");
    }
    // Taking the "proposal" label off and on again starts a fresh build of the same request.
    await gh(env, "DELETE", base + "/issues/" + number + "/labels/proposal");
    await gh(env, "POST", base + "/issues/" + number + "/labels", { labels: ["proposal"] });
    return json({ ok: true });
  }

  return fail("Unknown action");
}
