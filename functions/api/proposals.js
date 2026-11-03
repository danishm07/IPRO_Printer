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

// Has Cloudflare published this proposal's latest build yet?
// We fetch the viewer page from the proposal's preview address and compare it with the file on
// the proposal's branch (by git blob id). Same file means the preview is live. This needs no
// extra GitHub permission and works when the repo is private.
const PUBLISH_GRACE_MS = 10 * 60 * 1000;

function projectFrom(request, env) {
  const host = new URL(request.url).hostname;
  const match = /([a-z0-9-]+)\.pages\.dev$/i.exec(host);
  if (match) {
    return match[1];
  }
  return env.PAGES_PROJECT || "";
}

async function blobId(bytes) {
  const header = new TextEncoder().encode("blob " + bytes.length + "\0");
  const whole = new Uint8Array(header.length + bytes.length);
  whole.set(header, 0);
  whole.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", whole);
  return Array.from(new Uint8Array(digest)).map(function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

async function deployInfo(env, project, proposal) {
  if (!project) {
    return { deploy: "unknown", url: "", version: "" };
  }
  const repo = repoParts(env);
  const url = "https://proposal-" + proposal.number + "." + project + ".pages.dev/viewer/";
  let expected = "";
  try {
    const file = await gh(env, "GET", "/repos/" + repo.owner + "/" + repo.name + "/contents/site/viewer/index.html?ref=proposal-" + proposal.number);
    expected = file.sha;
  } catch (err) {
    return { deploy: "unknown", url: url, version: "" };
  }
  const version = expected.slice(0, 7);
  try {
    const res = await fetch(url + "?check=" + Date.now(), { cf: { cacheTtl: 0 } });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const served = await blobId(bytes);
      if (served === expected) {
        return { deploy: "live", url: url, version: version };
      }
    }
  } catch (err) {
    // not reachable yet
  }
  // If the comparison never matches (for example Cloudflare changed the file), stop waiting after a while.
  const age = Date.now() - new Date(proposal.builtAt || 0).getTime();
  if (proposal.builtAt && age > PUBLISH_GRACE_MS) {
    return { deploy: "live", url: url, version: version };
  }
  return { deploy: "publishing", url: url, version: version };
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
  const project = projectFrom(context.request, env);
  const lookups = proposals.map(async function (proposal) {
    const open = proposal.status !== "merged" && proposal.status !== "closed";
    if (!open || !proposal.hasBuild) {
      return;
    }
    const info = await deployInfo(env, project, proposal);
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
