export type Unsubscribe = () => void;

export type ByteTransportKind =
  | "android-usb"
  | "web-serial"
  | "node-serial"
  | "tcp"
  | "replay"
  /** Falsk övningsstation i webbläsaren (steg 4). */
  | "simulated";

export type TransportCloseReason = "initial" | "requested" | "completed" | "detached" | "error";

/**
 * A serializable state event. Consumers must not infer SPORTident protocol state
 * from these transport lifecycle events.
 */
export type TransportState =
  | { readonly status: "opening" }
  | { readonly status: "open" }
  | { readonly status: "closing"; readonly reason: TransportCloseReason }
  | { readonly status: "closed"; readonly reason: TransportCloseReason }
  | { readonly status: "detached"; readonly message: string }
  | { readonly status: "error"; readonly code: string; readonly message: string };

export interface ByteTransport {
  readonly kind: ByteTransportKind;
  open(): Promise<void>;
  close(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe;
  /** Subscribes and immediately invokes the handler with the current state. */
  onState(handler: (state: TransportState) => void): Unsubscribe;
}

export class TransportOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransportOperationError";
    this.code = code;
  }
}
