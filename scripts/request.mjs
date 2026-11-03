// Turns a proposal issue (from `gh issue view --json title,body,comments`) into
// the plain request file Claude reads: the original ask, then every follow-up in order.
// Usage: node scripts/request.mjs .studio/issue.json > .studio/request.md
import { readFileSync } from "node:fs";

const issue = JSON.parse(readFileSync(process.argv[2], "utf8"));

function readMeta(text) {
  const match = /<!--\s*studio:meta\s*(\{[\s\S]*?\})\s*-->/.exec(text || "");
  if (!match) {
    return {};
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    return {};
  }
}

function stripMarkers(text) {
  let out = text || "";
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  out = out.replace(/^\/refine\s*/i, "");
  return out.trim();
}

function describe(entry, heading) {
  const meta = readMeta(entry.body);
  const lines = [];
  lines.push("## " + heading + (meta.name ? " (from " + meta.name + ")" : ""));
  lines.push("");
  lines.push(stripMarkers(entry.body) || "(no text)");
  if (meta.image) {
    lines.push("");
    lines.push("Reference image attached: " + meta.image + " (open it with the Read tool).");
  }
  lines.push("");
  return lines.join("\n");
}

const parts = [];
parts.push("# Proposal: " + issue.title);
parts.push("");
parts.push(describe(issue, "Original request"));

let round = 0;
for (const comment of issue.comments || []) {
  if (!/^\/refine/i.test((comment.body || "").trim())) {
    continue;
  }
  round += 1;
  parts.push(describe(comment, "Follow-up " + round));
}

if (round > 0) {
  parts.push("When the follow-ups conflict with earlier requests, the latest follow-up wins. The branch already contains the earlier work, so change it rather than starting over.");
}

process.stdout.write(parts.join("\n") + "\n");
