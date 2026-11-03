// Runs before every /api route: checks the server is configured and the caller knows the team passcode.
import { checkConfig, isTeam, fail } from "../../lib/studio.js";

export async function onRequest(context) {
  const missing = checkConfig(context.env);
  if (missing.length) {
    return fail("The Studio is not set up yet. Missing settings: " + missing.join(", "), 500);
  }
  if (!isTeam(context.request, context.env)) {
    return fail("Wrong passcode", 401);
  }
  try {
    return await context.next();
  } catch (err) {
    return fail(err.message || "Something went wrong", err.status && err.status < 500 ? 400 : 500);
  }
}
