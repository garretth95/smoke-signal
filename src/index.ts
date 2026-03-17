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

  // Cron handler — availability checker (Phase 1)
  scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): void {
    // TODO: implement checker.ts and wire it here
    console.log("smoke-signal scheduled check triggered");
  },
};
