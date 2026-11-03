// POST /api/run  { number, action: "cancel" | "rerun" }
// cancel: stops the proposal's build that is running or waiting.
// rerun: builds the same request again (after a failed or cancelled build).
// Needs the GitHub token to have Actions: read and write.
import { json, fail, gh, repoParts, isBusy, labelNames } from "../../lib/studio.js";

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
