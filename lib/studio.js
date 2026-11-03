// Shared helpers for the Studio API (Cloudflare Pages Functions).
// Environment variables (set in the Cloudflare dashboard):
//   GITHUB_TOKEN    fine-grained token for this repo: Actions, Contents, Issues, Pull requests (read and write)
//   GITHUB_REPO     "owner/name", e.g. danishm07/IPRO_Printer
//   TEAM_PASSCODE   shared with teammates; needed for everything
//   ADMIN_PASSCODE  only for merging and closing proposals
//   (preview addresses come from Cloudflare's own report on GitHub, so no project name is needed)

const API = "https://api.github.com";

export function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

export function fail(message, status) {
  return json({ error: message }, status || 400);
}

function sameText(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

export function passFrom(request) {
  const url = new URL(request.url);
  return request.headers.get("x-studio-pass") || url.searchParams.get("pass") || "";
}

// Pasted dashboard values often carry stray spaces, so trim both sides.
// The team passcode ignores capital letters; the owner passcode does not.
function tidy(value) {
  return String(value || "").trim();
}

export function isTeam(request, env) {
  const pass = tidy(passFrom(request));
  const teamMatch = sameText(pass.toLowerCase(), tidy(env.TEAM_PASSCODE).toLowerCase());
  const adminMatch = sameText(pass, tidy(env.ADMIN_PASSCODE));
  return teamMatch || adminMatch;
}

export function isAdmin(request, env) {
  const pass = tidy(request.headers.get("x-studio-admin"));
  return sameText(pass, tidy(env.ADMIN_PASSCODE));
}

export function checkConfig(env) {
  const missing = [];
  for (const key of ["GITHUB_TOKEN", "GITHUB_REPO", "TEAM_PASSCODE", "ADMIN_PASSCODE"]) {
    if (!env[key]) {
      missing.push(key);
    }
  }
  return missing;
}

export function repoParts(env) {
  const pieces = String(env.GITHUB_REPO).split("/");
  return { owner: pieces[0], name: pieces[1] };
}

export async function gh(env, method, path, body) {
  const res = await fetch(API + path, {
    method: method,
    headers: {
      authorization: "Bearer " + env.GITHUB_TOKEN,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "ipro-studio",
      "content-type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { raw: text };
    }
  }
  if (!res.ok) {
    const message = data && data.message ? data.message : "GitHub request failed";
    const error = new Error(message + " (" + res.status + " " + method + " " + path + ")");
    error.status = res.status;
    throw error;
  }
  return data;
}

export async function graphql(env, query, variables) {
  const data = await gh(env, "POST", "/graphql", { query: query, variables: variables });
  if (data.errors && data.errors.length) {
    throw new Error(data.errors[0].message);
  }
  return data.data;
}

// ---------- issue body format ----------
// <!-- studio:meta {"name":"Leen","image":"proposals/12/ref-1.jpg"} -->
// request text
// <!-- studio:votes {"leen":{"name":"Leen","vote":"approve"}} -->

export function readMarker(text, name) {
  const pattern = new RegExp("<!--\\s*studio:" + name + "\\s*(\\{[\\s\\S]*?\\})\\s*-->");
  const match = pattern.exec(text || "");
  if (!match) {
    return {};
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return {};
  }
}

export function writeMarker(text, name, value) {
  const marker = "<!-- studio:" + name + " " + JSON.stringify(value) + " -->";
  const pattern = new RegExp("<!--\\s*studio:" + name + "\\s*\\{[\\s\\S]*?\\}\\s*-->");
  if (pattern.test(text || "")) {
    return text.replace(pattern, marker);
  }
  return (text || "") + "\n" + marker;
}

export function plainText(text) {
  let out = text || "";
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/^\/refine\s*/i, "");
  return out.trim();
}

export function cleanName(value) {
  return String(value || "").replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 40);
}

export function cleanText(value, limit) {
  return String(value || "").replace(/<!--|-->/g, "").trim().slice(0, limit);
}

// ---------- images ----------
// The page sends a JPEG data URL it has already shrunk; store it on the proposal branch.

export function imageBase64(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) {
    return null;
  }
  const base64 = match[2];
  // about 3 MB of image data at most
  if (base64.length > 4000000) {
    return null;
  }
  return { base64: base64, ext: match[1] === "jpeg" ? "jpg" : match[1] };
}

export async function ensureBranch(env, branch) {
  const repo = repoParts(env);
  try {
    await gh(env, "GET", "/repos/" + repo.owner + "/" + repo.name + "/git/ref/heads/" + branch);
    return;
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
  const main = await gh(env, "GET", "/repos/" + repo.owner + "/" + repo.name + "/git/ref/heads/main");
  await gh(env, "POST", "/repos/" + repo.owner + "/" + repo.name + "/git/refs", {
    ref: "refs/heads/" + branch,
    sha: main.object.sha
  });
}

export async function saveImage(env, number, image, index) {
  const repo = repoParts(env);
  const branch = "proposal-" + number;
  await ensureBranch(env, branch);
  const path = "proposals/" + number + "/ref-" + index + "." + image.ext;
  await gh(env, "PUT", "/repos/" + repo.owner + "/" + repo.name + "/contents/" + path, {
    message: "Reference image for proposal #" + number,
    content: image.base64,
    branch: branch
  });
  return path;
}

// ---------- one build at a time per person ----------
// A proposal counts as busy while it is building, or when it was just labeled and has no result yet.

export function isBusy(labels) {
  if (labels.indexOf("building") !== -1) {
    return true;
  }
  const finished = ["ready", "failed", "cancelled"];
  const hasResult = finished.some(function (name) {
    return labels.indexOf(name) !== -1;
  });
  return labels.indexOf("proposal") !== -1 && !hasResult;
}

export async function busyProposalFor(env, name) {
  const repo = repoParts(env);
  const issues = await gh(env, "GET", "/repos/" + repo.owner + "/" + repo.name + "/issues?labels=proposal&state=open&per_page=50");
  const wanted = String(name || "").toLowerCase();
  for (const issue of issues) {
    const meta = readMarker(issue.body, "meta");
    const labels = issue.labels.map(function (label) {
      return label.name;
    });
    if (String(meta.name || "").toLowerCase() === wanted && isBusy(labels)) {
      return issue.number;
    }
  }
  return 0;
}

export function labelNames(issue) {
  return issue.labels.map(function (label) {
    return typeof label === "string" ? label : label.name;
  });
}
