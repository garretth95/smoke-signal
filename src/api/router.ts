import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../index";
import {
  listWatches,
  createWatch,
  deleteWatch,
  getWatchHistory,
  listReminders,
  createReminder,
  deleteReminder,
  getStatus,
} from "./handlers";
import { renderUI } from "../ui";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", cors());

// UI
app.get("/", (c) => c.html(renderUI()));

// Watches
app.get("/api/watches", listWatches);
app.post("/api/watches", createWatch);
app.delete("/api/watches/:id", deleteWatch);
app.get("/api/watches/:id/history", getWatchHistory);

// Reminders
app.get("/api/reminders", listReminders);
app.post("/api/reminders", createReminder);
app.delete("/api/reminders/:id", deleteReminder);

// Status
app.get("/api/status", getStatus);

export default app;
