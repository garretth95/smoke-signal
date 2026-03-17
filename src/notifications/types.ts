export interface NotificationMessage {
  title: string;
  body: string;
  url?: string;
  priority?: "low" | "default" | "high" | "urgent";
  tags?: string[];
}

export interface NotificationChannel {
  readonly name: string;
  send(message: NotificationMessage): Promise<void>;
}
