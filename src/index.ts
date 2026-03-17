import { runCheck } from "./checker";
import { NtfyChannel } from "./notifications/ntfy";
import app from "./api/router";

export interface Env {
  DB: D1Database;
  NTFY_SERVER: string;
  NTFY_TOPIC: string;
}

export default {
  fetch: app.fetch.bind(app),

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const ntfy = new NtfyChannel(env.NTFY_SERVER, env.NTFY_TOPIC);
    await runCheck(env, ntfy);
  },
};
