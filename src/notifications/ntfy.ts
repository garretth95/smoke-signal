import type { NotificationChannel, NotificationMessage } from "./types";

export class NtfyChannel implements NotificationChannel {
  readonly name = "ntfy";

  private readonly server: string;
  private readonly topic: string;

  constructor(server: string, topic: string) {
    this.server = server.replace(/\/$/, "");
    this.topic = topic;
  }

  async send(message: NotificationMessage): Promise<void> {
    const headers: Record<string, string> = {
      "Content-Type": "text/plain",
      Title: message.title,
      Priority: message.priority ?? "default",
    };

    if (message.url) {
      headers["Click"] = message.url;
    }

    if (message.tags && message.tags.length > 0) {
      headers["Tags"] = message.tags.join(",");
    }

    const response = await fetch(`${this.server}/${this.topic}`, {
      method: "POST",
      headers,
      body: message.body,
    });

    if (!response.ok) {
      throw new Error(`ntfy send failed: ${response.status} ${response.statusText}`);
    }
  }
}
