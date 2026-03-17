import { runCheck } from "./checker";
import { NtfyChannel } from "./notifications/ntfy";

export interface Env {
  DB: D1Database;
  NTFY_SERVER: string;
  NTFY_TOPIC: string;
}

export default {
  // HTTP handler — management API (Phase 2)
  fetch(_request: Request, _env: Env, _ctx: ExecutionContext): Response {
    return new Response("smoke-signal ok", { status: 200 });
  },

  // Cron handler — availability checker
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const ntfy = new NtfyChannel(env.NTFY_SERVER, env.NTFY_TOPIC);
    await runCheck(env, ntfy);
  },
};
