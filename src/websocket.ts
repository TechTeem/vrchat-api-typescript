import { EventEmitter } from "node:events";

import WebSocket, { type RawData } from "ws";

import type {
  Badge,
  GroupLimitedMember,
  GroupRole,
  Notification,
  NotificationId,
  NotificationV2,
  User,
  UserId,
} from "./generated";

export const DEFAULT_VRCHAT_WEBSOCKET_URL = "wss://pipeline.vrchat.cloud";
const DEFAULT_RECONNECT_DELAY_MS = 1_000;
const DEFAULT_RECONNECT_BACKOFF_FACTOR = 2;
const DEFAULT_RECONNECT_DELAY_MAX_MS = 30_000;

export type VRChatWebsocketRawMessage = RawData;

export interface VRChatWebsocketCloseEvent {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface VRChatWebsocketMessage<
  TContent = unknown,
  TType extends string = string,
> {
  content: TContent;
  rawContent: unknown;
  receivedAt: Date;
  type: TType;
}

export interface VRChatWebsocketEnvelope<TContent = unknown> {
  content: TContent;
  type: string;
}

export interface VRChatWebsocketNotificationResponseEvent {
  notificationId: NotificationId;
  receiverId: UserId;
  responseId: NotificationId;
}

export interface VRChatWebsocketNotificationV2UpdateEvent {
  id: NotificationId;
  updates: Partial<Omit<NotificationV2, "id" | "version">>;
  version: number;
}

export interface VRChatWebsocketNotificationV2DeleteEvent {
  ids: Array<NotificationId>;
  version: number;
}

export interface VRChatWebsocketFriendAddEvent {
  user: User;
  userId: UserId;
}

export interface VRChatWebsocketFriendDeleteEvent {
  userId: UserId;
}

export interface VRChatWebsocketFriendOnlineEvent {
  canRequestInvite: boolean;
  location: string;
  platform: string;
  user: User;
  userId: UserId;
}

export interface VRChatWebsocketFriendActiveEvent {
  platform: string;
  user: User;
  userid: UserId;
}

export interface VRChatWebsocketFriendOfflineEvent {
  platform: string;
  userId: UserId;
}

export interface VRChatWebsocketFriendUpdateEvent {
  user: User;
  userId: UserId;
}

export interface VRChatWebsocketFriendLocationEvent {
  canRequestInvite: boolean;
  location: string;
  travelingToLocation: string;
  user: User;
  userId: UserId;
  worldId: string;
}

export type VRChatWebsocketUserUpdateProfile = Partial<User> & {
  bio?: string;
  currentAvatar?: string;
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  displayName?: string;
  fallbackAvatar?: string;
  id: UserId;
  profilePicOverride?: string;
  status?: string;
  statusDescription?: string;
  tags?: Array<string>;
  userIcon?: string;
  username?: string;
};

export interface VRChatWebsocketUserUpdateEvent {
  user: VRChatWebsocketUserUpdateProfile;
  userId: UserId;
}

export interface VRChatWebsocketUserLocationEvent {
  instance: string;
  location: string;
  travelingToLocation: string;
  user: User;
  userId: UserId;
}

export interface VRChatWebsocketUserBadgeAssignedEvent {
  badge: Badge;
}

export interface VRChatWebsocketUserBadgeUnassignedEvent {
  badgeId: string;
}

export interface VRChatWebsocketContentRefreshEvent {
  actionType: string;
  contentType: string;
  fileId?: string;
  itemId?: string;
  itemType?: string;
}

export interface VRChatWebsocketModifiedImageUpdateEvent {
  fileId: string;
  needsProcessing: boolean;
  pixelSize: number;
  versionNumber: number;
}

export interface VRChatWebsocketInstanceQueueJoinedEvent {
  instanceLocation: string;
  position: number;
}

export interface VRChatWebsocketInstanceQueueReadyEvent {
  expiry: string;
  instanceLocation: string;
}

export interface VRChatWebsocketGroupJoinedEvent {
  groupId: string;
}

export interface VRChatWebsocketGroupLeftEvent {
  groupId: string;
}

export interface VRChatWebsocketGroupMemberUpdatedEvent {
  member: GroupLimitedMember;
}

export interface VRChatWebsocketGroupRoleUpdatedEvent {
  role: GroupRole;
}

export interface VRChatWebsocketKnownEventMap {
  "clear-notification": undefined;
  "content-refresh": VRChatWebsocketContentRefreshEvent;
  "friend-active": VRChatWebsocketFriendActiveEvent;
  "friend-add": VRChatWebsocketFriendAddEvent;
  "friend-delete": VRChatWebsocketFriendDeleteEvent;
  "friend-location": VRChatWebsocketFriendLocationEvent;
  "friend-offline": VRChatWebsocketFriendOfflineEvent;
  "friend-online": VRChatWebsocketFriendOnlineEvent;
  "friend-update": VRChatWebsocketFriendUpdateEvent;
  "group-joined": VRChatWebsocketGroupJoinedEvent;
  "group-left": VRChatWebsocketGroupLeftEvent;
  "group-member-updated": VRChatWebsocketGroupMemberUpdatedEvent;
  "group-role-updated": VRChatWebsocketGroupRoleUpdatedEvent;
  "hide-notification": NotificationId;
  "instance-queue-joined": VRChatWebsocketInstanceQueueJoinedEvent;
  "instance-queue-ready": VRChatWebsocketInstanceQueueReadyEvent;
  "modified-image-update": VRChatWebsocketModifiedImageUpdateEvent;
  notification: Notification;
  "notification-v2": NotificationV2;
  "notification-v2-delete": VRChatWebsocketNotificationV2DeleteEvent;
  "notification-v2-update": VRChatWebsocketNotificationV2UpdateEvent;
  "response-notification": VRChatWebsocketNotificationResponseEvent;
  "see-notification": NotificationId;
  "user-badge-assigned": VRChatWebsocketUserBadgeAssignedEvent;
  "user-badge-unassigned": VRChatWebsocketUserBadgeUnassignedEvent;
  "user-location": VRChatWebsocketUserLocationEvent;
  "user-update": VRChatWebsocketUserUpdateEvent;
}

export type VRChatWebsocketEventMap = VRChatWebsocketKnownEventMap &
  Record<string, unknown>;

export type VRChatWebsocketKnownEventName = keyof VRChatWebsocketKnownEventMap;

export type VRChatWebsocketKnownMessage = {
  [TEventName in keyof VRChatWebsocketKnownEventMap]: VRChatWebsocketMessage<
    VRChatWebsocketKnownEventMap[TEventName],
    TEventName & string
  >;
}[keyof VRChatWebsocketKnownEventMap];

export interface VRChatWebsocketClientOptions {
  authToken?: string;
  autoReconnect?: boolean;
  baseUrl?: string;
  connectOnCreate?: boolean;
  headers?: HeadersInit;
  label?: string;
  metadata?: Record<string, unknown>;
  reconnectBackoffFactor?: number;
  reconnectDelayMaxMs?: number;
  reconnectDelayMs?: number;
  webSocketFactory?: typeof WebSocket;
}

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return new Error(value);
  }

  return new Error("VRChat websocket error.");
};

const decodeRawData = (data: RawData): string => {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }

  return data.toString("utf8");
};

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const createCloseEvent = (
  code: number,
  reason: Buffer,
): VRChatWebsocketCloseEvent => ({
  code,
  reason: reason.toString("utf8"),
  wasClean: code === 1000,
});

export class VRChatWebsocketClient extends EventEmitter {
  private authToken?: string;
  private connectPromise?: Promise<void>;
  private manuallyClosed = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private socket?: WebSocket;
  public readonly label?: string;
  public readonly metadata?: Readonly<Record<string, unknown>>;

  constructor(private readonly options: VRChatWebsocketClientOptions = {}) {
    super();
    this.authToken = options.authToken;
    this.label = options.label;
    this.metadata = options.metadata ? { ...options.metadata } : undefined;

    if (options.connectOnCreate && options.authToken) {
      void this.connect().catch((error) => {
        this.emit("error", toError(error));
      });
    }
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get currentAuthToken(): string | undefined {
    return this.authToken;
  }

  get readyState(): number | undefined {
    return this.socket?.readyState;
  }

  get url(): string {
    const url = new URL(this.options.baseUrl ?? DEFAULT_VRCHAT_WEBSOCKET_URL);
    if (this.authToken) {
      url.searchParams.set("authToken", this.authToken);
    }

    return url.toString();
  }

  on(eventName: "authenticated", listener: (authToken: string) => void): this;
  on(
    eventName: "close",
    listener: (event: VRChatWebsocketCloseEvent) => void,
  ): this;
  on(eventName: "error", listener: (error: Error) => void): this;
  on(
    eventName: "invalidMessage",
    listener: (error: Error, raw: VRChatWebsocketRawMessage) => void,
  ): this;
  on(
    eventName: "message",
    listener: (
      message: VRChatWebsocketKnownMessage | VRChatWebsocketMessage,
    ) => void,
  ): this;
  on(eventName: "open", listener: () => void): this;
  on(
    eventName: "rawMessage",
    listener: (raw: VRChatWebsocketRawMessage) => void,
  ): this;
  on(
    eventName: "reconnect",
    listener: (attempt: number, delayMs: number) => void,
  ): this;
  on<TEventName extends VRChatWebsocketKnownEventName>(
    eventName: TEventName,
    listener: (payload: VRChatWebsocketKnownEventMap[TEventName]) => void,
  ): this;
  on(eventName: string, listener: (...args: Array<any>) => void): this {
    return super.on(eventName, listener);
  }

  once(eventName: "authenticated", listener: (authToken: string) => void): this;
  once(
    eventName: "close",
    listener: (event: VRChatWebsocketCloseEvent) => void,
  ): this;
  once(eventName: "error", listener: (error: Error) => void): this;
  once(
    eventName: "invalidMessage",
    listener: (error: Error, raw: VRChatWebsocketRawMessage) => void,
  ): this;
  once(
    eventName: "message",
    listener: (
      message: VRChatWebsocketKnownMessage | VRChatWebsocketMessage,
    ) => void,
  ): this;
  once(eventName: "open", listener: () => void): this;
  once(
    eventName: "rawMessage",
    listener: (raw: VRChatWebsocketRawMessage) => void,
  ): this;
  once(
    eventName: "reconnect",
    listener: (attempt: number, delayMs: number) => void,
  ): this;
  once<TEventName extends VRChatWebsocketKnownEventName>(
    eventName: TEventName,
    listener: (payload: VRChatWebsocketKnownEventMap[TEventName]) => void,
  ): this;
  once(eventName: string, listener: (...args: Array<any>) => void): this {
    return super.once(eventName, listener);
  }

  off(eventName: "authenticated", listener: (authToken: string) => void): this;
  off(
    eventName: "close",
    listener: (event: VRChatWebsocketCloseEvent) => void,
  ): this;
  off(eventName: "error", listener: (error: Error) => void): this;
  off(
    eventName: "invalidMessage",
    listener: (error: Error, raw: VRChatWebsocketRawMessage) => void,
  ): this;
  off(
    eventName: "message",
    listener: (
      message: VRChatWebsocketKnownMessage | VRChatWebsocketMessage,
    ) => void,
  ): this;
  off(eventName: "open", listener: () => void): this;
  off(
    eventName: "rawMessage",
    listener: (raw: VRChatWebsocketRawMessage) => void,
  ): this;
  off(
    eventName: "reconnect",
    listener: (attempt: number, delayMs: number) => void,
  ): this;
  off<TEventName extends VRChatWebsocketKnownEventName>(
    eventName: TEventName,
    listener: (payload: VRChatWebsocketKnownEventMap[TEventName]) => void,
  ): this;
  off(eventName: string, listener: (...args: Array<any>) => void): this {
    return super.off(eventName, listener);
  }

  async authenticate(authToken: string): Promise<void> {
    this.setAuthToken(authToken);
    await this.connect();
  }

  async connect(): Promise<void> {
    if (!this.authToken) {
      throw new Error(
        "VRChat websocket authentication requires an auth token cookie.",
      );
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    if (
      this.socket?.readyState === WebSocket.CONNECTING &&
      this.connectPromise
    ) {
      return this.connectPromise;
    }

    this.clearReconnectTimer();
    this.manuallyClosed = false;

    const socket = this.createSocket(this.authToken);
    this.socket = socket;

    const connectPromise = new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off("open", handleOpen);
        socket.off("error", handleConnectError);
        socket.off("close", handleEarlyClose);
      };

      const handleOpen = (): void => {
        cleanup();
        resolve();
      };

      const handleConnectError = (error: Error): void => {
        cleanup();
        reject(toError(error));
      };

      const handleEarlyClose = (code: number, reason: Buffer): void => {
        cleanup();
        reject(
          new Error(
            `VRChat websocket closed before opening (${code}): ${reason.toString("utf8") || "no reason provided"}`,
          ),
        );
      };

      socket.once("open", handleOpen);
      socket.once("error", handleConnectError);
      socket.once("close", handleEarlyClose);
    });

    socket.on("open", () => {
      if (this.socket !== socket) {
        return;
      }

      this.reconnectAttempt = 0;
      this.emit("authenticated", this.authToken as string);
      this.emit("open");
    });

    socket.on("close", (code: number, reason: Buffer) => {
      if (this.socket !== socket) {
        return;
      }

      this.connectPromise = undefined;
      this.emit("close", createCloseEvent(code, reason));

      if (!this.manuallyClosed) {
        this.scheduleReconnect();
      }
    });

    socket.on("error", (error: Error) => {
      if (this.socket !== socket) {
        return;
      }

      this.emit("error", toError(error));
    });

    socket.on("message", (data: RawData) => {
      if (this.socket !== socket) {
        return;
      }

      this.emit("rawMessage", data);

      try {
        const envelope = tryParseJson(
          decodeRawData(data),
        ) as Partial<VRChatWebsocketEnvelope>;

        if (!envelope || typeof envelope.type !== "string") {
          throw new Error("VRChat websocket message is missing a string type.");
        }

        const rawContent = envelope.content;
        const content =
          typeof rawContent === "string"
            ? tryParseJson(rawContent)
            : rawContent;
        const message: VRChatWebsocketMessage = {
          content,
          rawContent,
          receivedAt: new Date(),
          type: envelope.type,
        };

        this.emit("message", message);
        this.emit(message.type, message.content);
      } catch (error) {
        this.emit("invalidMessage", toError(error), data);
      }
    });

    this.connectPromise = connectPromise.finally(() => {
      if (this.socket === socket) {
        this.connectPromise = undefined;
      }
    });

    return this.connectPromise;
  }

  close(code?: number, reason?: string): void {
    this.manuallyClosed = true;
    this.clearReconnectTimer();

    if (!this.socket) {
      return;
    }

    if (
      this.socket.readyState === WebSocket.CLOSED ||
      this.socket.readyState === WebSocket.CLOSING
    ) {
      return;
    }

    this.socket.close(code, reason);
  }

  clearAuthToken(): void {
    this.setAuthToken(undefined);
  }

  async reconnect(): Promise<void> {
    if (!this.authToken) {
      throw new Error(
        "VRChat websocket authentication requires an auth token cookie.",
      );
    }

    this.close();
    await this.connect();
  }

  send(data: string | Buffer | ArrayBuffer | ArrayBufferView | object): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("VRChat websocket is not connected.");
    }

    const payload =
      typeof data === "string" ||
      Buffer.isBuffer(data) ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data)
        ? data
        : JSON.stringify(data);

    this.socket.send(payload);
  }

  setAuthToken(authToken?: string): void {
    const nextToken = authToken?.trim() || undefined;
    const tokenChanged = this.authToken !== nextToken;
    this.authToken = nextToken;

    if (!nextToken) {
      this.close();
      return;
    }

    if (!tokenChanged) {
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      void this.reconnect().catch((error) => {
        this.emit("error", toError(error));
      });
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private createSocket(authToken: string): WebSocket {
    const url = new URL(this.options.baseUrl ?? DEFAULT_VRCHAT_WEBSOCKET_URL);
    url.searchParams.set("authToken", authToken);

    const headers = Object.fromEntries(
      new Headers(this.options.headers).entries(),
    );
    const WebSocketFactory = this.options.webSocketFactory ?? WebSocket;

    return new WebSocketFactory(url, {
      headers,
    });
  }

  private getReconnectDelay(): number {
    const initialDelay = Math.max(
      0,
      this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
    );
    const maxDelay = Math.max(
      initialDelay,
      this.options.reconnectDelayMaxMs ?? DEFAULT_RECONNECT_DELAY_MAX_MS,
    );
    const backoffFactor = Math.max(
      1,
      this.options.reconnectBackoffFactor ?? DEFAULT_RECONNECT_BACKOFF_FACTOR,
    );

    return Math.min(
      maxDelay,
      initialDelay * backoffFactor ** Math.max(0, this.reconnectAttempt - 1),
    );
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    if (this.options.autoReconnect === false || !this.authToken) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = this.getReconnectDelay();
    this.emit("reconnect", this.reconnectAttempt, delayMs);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        this.emit("error", toError(error));
      });
    }, delayMs);
  }
}
