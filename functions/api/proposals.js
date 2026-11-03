// GET /api/proposals
// Everything the Studio page shows, in one GitHub query: each proposal's request, follow-ups,
// build status, Claude's summary, votes and preview link. Cached for a few seconds.
import { json, gh, graphql, repoParts, readMarker, plainText, isAdmin } from "../../lib/studio.js";

const QUERY = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(first: 40, labels: ["proposal"], orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number title body state stateReason createdAt
        labels(first: 10) { nodes { name } }
        comments(last: 40) { nodes { body createdAt } }
      }
    }
    pullRequests(first: 60, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes { number headRefName state url }
    }
  }
}`;

let cache = null;

// Cloudflare Pages reports each branch deploy on GitHub as a check named "Cloudflare Pages",
// including the branch's preview address. Reading it means the Studio only offers a preview
// once it is really published, at the address Cloudflare actually gave it.
// Needs the GitHub token to have Checks: read. Without it, deploy stays "unknown" and the
// page works out the address from its own domain instead.
async function deployInfo(env, number) {
  const repo = repoParts(env);
  const path = "/repos/" + repo.owner + "/" + repo.name + "/commits/proposal-" + number + "/check-runs?check_name=" + encodeURIComponent("Cloudflare Pages");
  try {
    const data = await gh(env, "GET", path);
    const run = (data.check_runs || [])[0];
    if (!run) {
      return { deploy: "publishing", url: "", version: "" };
    }
    const summary = (run.output && run.output.summary) || "";
    const match = /Branch Preview URL:[\s\S]*?href='([^']+)'/.exec(summary);
    const url = match ? match[1].replace(/\/$/, "") + "/viewer/" : "";
    const version = (run.head_sha || "").slice(0, 7);
    if (run.status !== "completed") {
      return { deploy: "publishing", url: url, version: version };
    }
    if (run.conclusion !== "success") {
      return { deploy: "failed", url: url, version: version };
    }
    return { deploy: "live", url: url, version: version };
  } catch (err) {
    return { deploy: "unknown", url: "", version: "" };
  }
}

function shape(env, issue, pulls) {
  const labels = issue.labels.nodes.map(function (label) {
    return label.name;
  });
  const meta = readMarker(issue.body, "meta");
  const votes = readMarker(issue.body, "votes");
  const pull = pulls["proposal-" + issue.number] || null;

  const followups = [];
  let summary = "";
  let failure = "";
  let builtAt = "";
  for (const comment of issue.comments.nodes) {
    const body = comment.body || "";
    if (/^\s*\/refine/i.test(body)) {
      const commentMeta = readMarker(body, "meta");
      followups.push({ name: commentMeta.name || "", text: plainText(body), image: commentMeta.image || "", at: comment.createdAt });
    } else if (body.indexOf("<!-- studio:summary -->") !== -1) {
      summary = plainText(body);
      failure = "";
      builtAt = comment.createdAt;
    } else if (body.indexOf("<!-- studio:failed -->") !== -1) {
      failure = plainText(body);
    }
  }

  let status = "queued";
  if (pull && pull.state === "MERGED") {
    status = "merged";
  } else if (issue.state === "CLOSED") {
    status = "closed";
  } else if (labels.indexOf("building") !== -1) {
    status = "building";
  } else if (labels.indexOf("cancelled") !== -1) {
    status = "cancelled";
  } else if (labels.indexOf("failed") !== -1) {
    status = "failed";
  } else if (labels.indexOf("ready") !== -1) {
    status = "ready";
  }

  const approve = [];
  const reject = [];
  for (const key of Object.keys(votes)) {
    const entry = votes[key];
    if (entry && entry.vote === "approve") {
      approve.push(entry.name);
    } else if (entry && entry.vote === "reject") {
      reject.push(entry.name);
    }
  }

  return {
    number: issue.number,
    title: issue.title,
    name: meta.name || "",
    text: plainText(issue.body),
    image: meta.image || "",
    createdAt: issue.createdAt,
    followups: followups,
    status: status,
    summary: summary,
    failure: status === "failed" ? failure : "",
    builtAt: builtAt,
    approve: approve,
    reject: reject,
    hasBuild: Boolean(pull || summary),
    deploy: "unknown",
    preview: "",
    version: "",
    pullUrl: pull ? pull.url : ""
  };
}

export async function onRequestGet(context) {
  const env = context.env;
  const url = new URL(context.request.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const admin = isAdmin(context.request, env);
  if (!fresh && cache && Date.now() - cache.time < 8000) {
    return json(Object.assign({}, cache.data, { admin: admin }));
  }
  const repo = repoParts(env);
  const data = await graphql(env, QUERY, { owner: repo.owner, name: repo.name });
  const pulls = {};
  for (const pull of data.repository.pullRequests.nodes) {
    if (!pulls[pull.headRefName]) {
      pulls[pull.headRefName] = pull;
    }
  }
  const proposals = data.repository.issues.nodes.map(function (issue) {
    return shape(env, issue, pulls);
  });
  const lookups = proposals.map(async function (proposal) {
    const open = proposal.status !== "merged" && proposal.status !== "closed";
    if (!open || !proposal.hasBuild) {
      return;
    }
    const info = await deployInfo(env, proposal.number);
    proposal.deploy = info.deploy;
    proposal.preview = info.url;
    proposal.version = info.version;
  });
  await Promise.all(lookups);
  const result = {
    proposals: proposals,
    liveUrl: "/viewer/",
    admin: false
  };
  cache = { time: Date.now(), data: result };
  return json(Object.assign({}, result, { admin: admin }));
}
