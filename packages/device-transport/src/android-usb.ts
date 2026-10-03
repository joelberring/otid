import {
  TransportOperationError,
  type ByteTransport,
  type TransportCloseReason,
  type TransportState,
  type Unsubscribe
} from "./byte-transport";
import { decodeCaptureBytesBase64, encodeCaptureBytesBase64 } from "./capture";
import { errorMessage, TransportListeners } from "./listeners";

export interface AndroidUsbDeviceDescriptor {
  readonly deviceId: string;
  readonly vendorId: number;
  readonly productId: number;
  readonly portIndexes: readonly number[];
  readonly productName?: string;
  readonly manufacturerName?: string;
  readonly serialNumber?: string;
}

export interface AndroidUsbSerialConfiguration {
  readonly baudRate: number;
  readonly dataBits: 7 | 8;
  readonly stopBits: 1 | 2;
  readonly parity: "none" | "even" | "odd";
  readonly flowControl: "none";
}

export interface AndroidUsbWireListDevicesResponse {
  readonly devices: readonly AndroidUsbDeviceDescriptor[];
}

export interface AndroidUsbWirePermissionRequest {
  readonly deviceId: string;
}

export interface AndroidUsbWirePermissionResponse {
  readonly granted: boolean;
}

export interface AndroidUsbWireOpenRequest {
  readonly connectionId: string;
  readonly deviceId: string;
  readonly portIndex: number;
  readonly configuration: AndroidUsbSerialConfiguration;
}

export interface AndroidUsbWireConnectionRequest {
  readonly connectionId: string;
}

export interface AndroidUsbWireWriteRequest extends AndroidUsbWireConnectionRequest {
  readonly bytesBase64: string;
  readonly writeTimeoutMs: number;
}

export interface AndroidUsbWireListenerHandle {
  remove(): Promise<void>;
}

interface AndroidUsbWireEventBase {
  readonly connectionId: string | null;
  /** Positive native counter represented as decimal text to preserve Kotlin Long. */
  readonly nativeSequence: string;
  /** Android SystemClock.elapsedRealtimeNanos(), represented as decimal text. */
  readonly elapsedRealtimeNanos: string;
}

export interface AndroidUsbWireBytesEvent extends AndroidUsbWireEventBase {
  readonly type: "bytes";
  readonly connectionId: string;
  readonly bytesBase64: string;
}

export interface AndroidUsbWireAttachEvent extends AndroidUsbWireEventBase {
  readonly type: "attach";
  readonly device: AndroidUsbDeviceDescriptor;
}

export interface AndroidUsbWireDetachEvent extends AndroidUsbWireEventBase {
  readonly type: "detach";
  readonly connectionId: string;
  readonly deviceId: string;
}

export type AndroidUsbWireStateStatus = "opening" | "open" | "closing" | "closed" | "error";

export type AndroidUsbWireStateEvent = AndroidUsbWireEventBase & { readonly connectionId: string } & (
  | {
      readonly type: "state";
      readonly status: Exclude<AndroidUsbWireStateStatus, "error">;
      readonly code: null;
      readonly message: null;
    }
  | {
      readonly type: "state";
      readonly status: "error";
      readonly code: string;
      readonly message: string;
    }
);

export type AndroidUsbWireEvent =
  | AndroidUsbWireBytesEvent
  | AndroidUsbWireAttachEvent
  | AndroidUsbWireDetachEvent
  | AndroidUsbWireStateEvent;

/** JSON-only Capacitor boundary. Native input is runtime-validated below. */
export interface AndroidUsbCapacitorPlugin {
  listDevices(): Promise<AndroidUsbWireListDevicesResponse>;
  requestPermission(request: AndroidUsbWirePermissionRequest): Promise<AndroidUsbWirePermissionResponse>;
  open(request: AndroidUsbWireOpenRequest): Promise<void>;
  close(request: AndroidUsbWireConnectionRequest): Promise<void>;
  write(request: AndroidUsbWireWriteRequest): Promise<void>;
  addListener(
    eventName: "usbEvent",
    listener: (event: AndroidUsbWireEvent) => void
  ): Promise<AndroidUsbWireListenerHandle>;
}

export interface AndroidUsbBridge {
  listDevices(): Promise<readonly AndroidUsbDeviceDescriptor[]>;
  requestPermission(deviceId: string): Promise<boolean>;
  open(
    connectionId: string,
    deviceId: string,
    portIndex: number,
    configuration: AndroidUsbSerialConfiguration
  ): Promise<void>;
  close(connectionId: string): Promise<void>;
  write(connectionId: string, bytes: Uint8Array, writeTimeoutMs: number): Promise<void>;
}

export interface AndroidUsbTransportOptions {
  readonly deviceId: string;
  readonly portIndex: number;
  readonly configuration: AndroidUsbSerialConfiguration;
  readonly writeTimeoutMs: number;
  readonly connectionIdFactory?: () => string;
}

type AndroidLifecycle = "closed" | "opening" | "open" | "closing" | "error";

function wireError(code: string, message: string, cause?: unknown): TransportOperationError {
  return new TransportOperationError(code, message, cause === undefined ? undefined : { cause });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path} måste vara ett objekt`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path}.${key} stöds inte`);
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path}.${key} saknas`);
    }
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path} måste vara en icke-tom sträng`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, path);
}

function boundedInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path} måste vara ett heltal mellan ${min} och ${max}`);
  }
  return value as number;
}

function decimalString(value: unknown, path: string, allowZero: boolean): string {
  const pattern = allowZero ? /^(?:0|[1-9][0-9]*)$/u : /^[1-9][0-9]*$/u;
  if (
    typeof value !== "string"
    || value.length > 19
    || !pattern.test(value)
    || BigInt(value) > 9_223_372_036_854_775_807n
  ) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path} måste vara en kanonisk decimalsträng`);
  }
  return value;
}

function parseDescriptor(value: unknown, path: string): AndroidUsbDeviceDescriptor {
  const source = record(value, path);
  exactKeys(
    source,
    ["deviceId", "vendorId", "productId", "portIndexes"],
    ["productName", "manufacturerName", "serialNumber"],
    path
  );
  if (!Array.isArray(source.portIndexes) || source.portIndexes.length === 0) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path}.portIndexes måste vara en icke-tom array`);
  }
  const portIndexes = source.portIndexes.map((portIndex, index) =>
    boundedInteger(portIndex, `${path}.portIndexes[${index}]`, 0, 255)
  );
  if (new Set(portIndexes).size !== portIndexes.length) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `${path}.portIndexes får inte innehålla dubletter`);
  }
  const descriptor: AndroidUsbDeviceDescriptor = {
    deviceId: nonEmptyString(source.deviceId, `${path}.deviceId`),
    vendorId: boundedInteger(source.vendorId, `${path}.vendorId`, 0, 65_535),
    productId: boundedInteger(source.productId, `${path}.productId`, 0, 65_535),
    portIndexes: Object.freeze([...portIndexes])
  };
  const productName = optionalString(source.productName, `${path}.productName`);
  const manufacturerName = optionalString(source.manufacturerName, `${path}.manufacturerName`);
  const serialNumber = optionalString(source.serialNumber, `${path}.serialNumber`);
  return Object.freeze({
    ...descriptor,
    ...(productName === undefined ? {} : { productName }),
    ...(manufacturerName === undefined ? {} : { manufacturerName }),
    ...(serialNumber === undefined ? {} : { serialNumber })
  });
}

function parseWireEvent(value: unknown): AndroidUsbWireEvent {
  const source = record(value, "usbEvent");
  const type = nonEmptyString(source.type, "usbEvent.type");
  const baseKeys = ["type", "connectionId", "nativeSequence", "elapsedRealtimeNanos"] as const;
  if (type === "bytes") exactKeys(source, [...baseKeys, "bytesBase64"], [], "usbEvent");
  else if (type === "attach") exactKeys(source, [...baseKeys, "device"], [], "usbEvent");
  else if (type === "detach") exactKeys(source, [...baseKeys, "deviceId"], [], "usbEvent");
  else if (type === "state") exactKeys(source, [...baseKeys, "status", "code", "message"], [], "usbEvent");
  else throw wireError("ANDROID_USB_INVALID_WIRE_DATA", `Okänd usbEvent.type: ${type}`);
  const connectionId = source.connectionId === null ? null : nonEmptyString(source.connectionId, "usbEvent.connectionId");
  const base = {
    connectionId,
    nativeSequence: decimalString(source.nativeSequence, "usbEvent.nativeSequence", false),
    elapsedRealtimeNanos: decimalString(source.elapsedRealtimeNanos, "usbEvent.elapsedRealtimeNanos", true)
  };
  if (type === "bytes") {
    if (connectionId === null) throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "bytes-event kräver connectionId");
    const bytesBase64 = nonEmptyString(source.bytesBase64, "usbEvent.bytesBase64");
    decodeCaptureBytesBase64(bytesBase64, "usbEvent.bytesBase64");
    return Object.freeze({ type, ...base, connectionId, bytesBase64 });
  }
  if (type === "attach") {
    return Object.freeze({ type, ...base, device: parseDescriptor(source.device, "usbEvent.device") });
  }
  if (type === "detach") {
    if (connectionId === null) throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "detach-event kräver connectionId");
    return Object.freeze({ type, ...base, connectionId, deviceId: nonEmptyString(source.deviceId, "usbEvent.deviceId") });
  }
  if (type === "state") {
    if (connectionId === null) throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "state-event kräver connectionId");
    const status = nonEmptyString(source.status, "usbEvent.status");
    if (status === "error") {
      return Object.freeze({
        type,
        ...base,
        connectionId,
        status,
        code: nonEmptyString(source.code, "usbEvent.code"),
        message: nonEmptyString(source.message, "usbEvent.message")
      });
    }
    if (status !== "opening" && status !== "open" && status !== "closing" && status !== "closed") {
      throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "usbEvent.status är okänd");
    }
    if (source.code !== null || source.message !== null) {
      throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "state-event utan error måste ha null code/message");
    }
    return Object.freeze({ type, ...base, connectionId, status, code: null, message: null });
  }
  throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "Okänd usbEvent.type");
}

function parsePermissionResponse(value: unknown): AndroidUsbWirePermissionResponse {
  const source = record(value, "requestPermission response");
  exactKeys(source, ["granted"], [], "requestPermission response");
  if (typeof source.granted !== "boolean") {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "requestPermission response.granted måste vara boolean");
  }
  return Object.freeze({ granted: source.granted });
}

function validateConfiguration(value: AndroidUsbSerialConfiguration): AndroidUsbSerialConfiguration {
  const source = record(value as unknown, "configuration");
  exactKeys(source, ["baudRate", "dataBits", "stopBits", "parity", "flowControl"], [], "configuration");
  if (!Number.isSafeInteger(value.baudRate) || value.baudRate <= 0) {
    throw wireError("ANDROID_USB_INVALID_CONFIGURATION", "baudRate måste vara ett positivt heltal");
  }
  if (value.dataBits !== 7 && value.dataBits !== 8) {
    throw wireError("ANDROID_USB_INVALID_CONFIGURATION", "dataBits måste vara 7 eller 8");
  }
  if (value.stopBits !== 1 && value.stopBits !== 2) {
    throw wireError("ANDROID_USB_INVALID_CONFIGURATION", "stopBits måste vara 1 eller 2");
  }
  if (value.parity !== "none" && value.parity !== "even" && value.parity !== "odd") {
    throw wireError("ANDROID_USB_INVALID_CONFIGURATION", "parity är ogiltig");
  }
  if (value.flowControl !== "none") {
    throw wireError("ANDROID_USB_INVALID_CONFIGURATION", "flowControl måste vara none i detta snitt");
  }
  return Object.freeze({
    baudRate: value.baudRate,
    dataBits: value.dataBits,
    stopBits: value.stopBits,
    parity: value.parity,
    flowControl: value.flowControl
  });
}

function defaultConnectionId(): string {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw wireError("ANDROID_USB_CONNECTION_ID_UNAVAILABLE", "crypto.randomUUID saknas");
  }
  return globalThis.crypto.randomUUID();
}

export async function listAndroidUsbDevices(
  plugin: AndroidUsbCapacitorPlugin
): Promise<readonly AndroidUsbDeviceDescriptor[]> {
  const response = record(await plugin.listDevices() as unknown, "listDevices response");
  exactKeys(response, ["devices"], [], "listDevices response");
  if (!Array.isArray(response.devices)) {
    throw wireError("ANDROID_USB_INVALID_WIRE_DATA", "listDevices response.devices måste vara en array");
  }
  return Object.freeze(response.devices.map((device, index) => parseDescriptor(device, `devices[${index}]`)));
}

/** Raw Android USB transport. It validates JSON wire data and never interprets protocol bytes. */
export class AndroidUsbTransport implements ByteTransport {
  readonly kind = "android-usb" as const;
  readonly #plugin: AndroidUsbCapacitorPlugin;
  readonly #deviceId: string;
  readonly #portIndex: number;
  readonly #configuration: AndroidUsbSerialConfiguration;
  readonly #writeTimeoutMs: number;
  readonly #connectionIdFactory: () => string;
  readonly #listeners = new TransportListeners({ status: "closed", reason: "initial" });
  #lifecycle: AndroidLifecycle = "closed";
  #generation = 0;
  #connectionId: string | undefined;
  #listenerHandle: AndroidUsbWireListenerHandle | undefined;
  #lastNativeSequence: bigint | undefined;
  #lastElapsedRealtimeNanos: bigint | undefined;
  #openingRx: Uint8Array[] = [];
  #writeTail: Promise<void> = Promise.resolve();
  #openTask: Promise<void> | undefined;
  #closeTask: Promise<void> | undefined;
  #nativeCloseTask: Promise<TransportOperationError | undefined> | undefined;
  #closeReason: TransportCloseReason | undefined;
  #nativeOpenStarted = false;
  #nativeOpenCommitted = false;
  #nativeClosedObserved = false;
  #stopQueuedWrites = false;

  constructor(plugin: AndroidUsbCapacitorPlugin, options: AndroidUsbTransportOptions) {
    this.#plugin = plugin;
    this.#deviceId = nonEmptyString(options.deviceId, "deviceId");
    this.#portIndex = boundedInteger(options.portIndex, "portIndex", 0, 255);
    this.#configuration = validateConfiguration(options.configuration);
    this.#writeTimeoutMs = boundedInteger(options.writeTimeoutMs, "writeTimeoutMs", 1, 60_000);
    this.#connectionIdFactory = options.connectionIdFactory ?? defaultConnectionId;
  }

  onBytes(handler: (chunk: Uint8Array) => void): Unsubscribe {
    return this.#listeners.onBytes(handler);
  }

  onState(handler: (state: TransportState) => void): Unsubscribe {
    return this.#listeners.onState(handler);
  }

  async open(): Promise<void> {
    if (this.#lifecycle === "open") return;
    if (this.#lifecycle !== "closed") {
      throw wireError("ANDROID_USB_ALREADY_OPEN", "Android USB-transporten är redan öppen eller öppnas");
    }
    const connectionId = nonEmptyString(this.#connectionIdFactory(), "connectionId");
    const generation = this.#generation + 1;
    this.#generation = generation;
    this.#connectionId = connectionId;
    this.#lifecycle = "opening";
    this.#closeReason = undefined;
    this.#lastNativeSequence = undefined;
    this.#lastElapsedRealtimeNanos = undefined;
    this.#openingRx = [];
    this.#nativeOpenStarted = false;
    this.#nativeOpenCommitted = false;
    this.#nativeClosedObserved = false;
    this.#stopQueuedWrites = false;
    // Defer the body one microtask so #openTask is installed before a plugin
    // can synchronously deliver an event from addListener().
    const attempt = Promise.resolve().then(() => this.#performOpen(generation, connectionId));
    this.#openTask = attempt;
    this.#listeners.emitState({ status: "opening" });
    try {
      await attempt;
    } catch (error) {
      const operationError = error instanceof TransportOperationError
        ? error
        : wireError("ANDROID_USB_OPEN_FAILED", errorMessage(error), error);

      const cancelled = generation !== this.#generation || this.#closeReason !== undefined;
      if (!cancelled) {
        this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
        try {
          await this.#closeFromOutside("error");
        } catch {
          // #closeFromOutside has already exposed the cleanup/close failure as state.
        }
      } else if (this.#closeTask !== undefined) {
        try {
          await this.#closeTask;
        } catch {
          // The initiating close path has already exposed its failure as state.
        }
      }
      throw operationError;
    } finally {
      if (this.#openTask === attempt) this.#openTask = undefined;
    }
  }

  async close(): Promise<void> {
    return this.#closeFromOutside("requested");
  }

  async write(bytes: Uint8Array): Promise<void> {
    const copy = bytes.slice();
    if (copy.byteLength === 0) throw wireError("EMPTY_WRITE", "Tomma skrivningar tillåts inte");
    if (this.#lifecycle !== "open" || this.#connectionId === undefined) {
      throw wireError("ANDROID_USB_NOT_OPEN", "Android USB-transporten är inte öppen");
    }
    const connectionId = this.#connectionId;
    const generation = this.#generation;
    const operation = this.#writeTail.then(async () => {
      if (generation !== this.#generation || this.#connectionId !== connectionId) {
        throw wireError("ANDROID_USB_NOT_OPEN", "Android USB-transporten är inte öppen");
      }
      if (this.#stopQueuedWrites) {
        throw wireError("ANDROID_USB_WRITE_CANCELLED", "Skrivningen avbröts efter transportfel eller frånkoppling");
      }
      if (this.#lifecycle !== "open" && !(this.#lifecycle === "closing" && this.#closeReason === "requested")) {
        throw wireError("ANDROID_USB_NOT_OPEN", "Android USB-transporten är inte öppen");
      }
      try {
        await this.#plugin.write({
          connectionId,
          bytesBase64: encodeCaptureBytesBase64(copy),
          writeTimeoutMs: this.#writeTimeoutMs
        });
      } catch (error) {
        const operationError = wireError("ANDROID_USB_WRITE_FAILED", errorMessage(error), error);
        this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
        this.#beginAutomaticClose("error");
        throw operationError;
      }
    });
    this.#writeTail = operation.catch(() => undefined);
    return operation;
  }

  async #performOpen(generation: number, connectionId: string): Promise<void> {
    const listener = await this.#plugin.addListener(
      "usbEvent",
      (event) => this.#receiveWireEvent(generation, event as unknown)
    );
    if (generation !== this.#generation) {
      const cleanupError = await this.#removeListener(listener);
      if (cleanupError !== undefined) this.#emitOperationError(cleanupError);
      throw wireError("ANDROID_USB_OPEN_CANCELLED", "USB-öppningens listener tillhör en avslutad generation");
    }
    // Store the handle before the cancellation check so the serialized close
    // path can retry removal if the first native removal attempt fails.
    this.#listenerHandle = listener;
    if (!this.#isOpening(generation, connectionId)) {
      throw wireError("ANDROID_USB_OPEN_CANCELLED", "USB-öppningen avbröts innan listenern var registrerad");
    }

    const permission = parsePermissionResponse(
      await this.#plugin.requestPermission({ deviceId: this.#deviceId }) as unknown
    );
    if (!this.#isOpening(generation, connectionId)) {
      throw wireError("ANDROID_USB_OPEN_CANCELLED", "USB-öppningen avbröts under behörighetsdialogen");
    }
    if (!permission.granted) throw wireError("ANDROID_USB_PERMISSION_DENIED", "USB-behörighet nekades");

    if (!this.#isOpening(generation, connectionId)) {
      throw wireError("ANDROID_USB_OPEN_CANCELLED", "USB-öppningen avbröts före native open");
    }
    this.#nativeOpenStarted = true;
    try {
      await this.#plugin.open({
        connectionId,
        deviceId: this.#deviceId,
        portIndex: this.#portIndex,
        configuration: this.#configuration
      });
    } catch (error) {
      const operationError = error instanceof TransportOperationError
        ? error
        : wireError("ANDROID_USB_OPEN_FAILED", errorMessage(error), error);
      const closeError = await this.#tryNativeClose(connectionId);
      if (closeError !== undefined) this.#emitOperationError(closeError);
      throw operationError;
    }

    if (!this.#isOpening(generation, connectionId)) {
      // A close may have reached native before open completed. Close once more
      // after physical open/configuration has definitely settled.
      this.#nativeClosedObserved = false;
      const closeError = await this.#tryNativeClose(connectionId, true);
      if (closeError !== undefined) this.#emitOperationError(closeError);
      throw wireError("ANDROID_USB_OPEN_CANCELLED", "USB-öppningen avbröts av native-livscykeln");
    }
    this.#nativeOpenCommitted = true;
    this.#lifecycle = "open";
    this.#listeners.emitState({ status: "open" });
    this.#flushOpeningRx();
  }

  #receiveWireEvent(generation: number, input: unknown): void {
    if (generation !== this.#generation) return;
    if (this.#lifecycle === "closed" && this.#openTask === undefined) return;
    try {
      const event = parseWireEvent(input);
      const sequence = BigInt(event.nativeSequence);
      const time = BigInt(event.elapsedRealtimeNanos);
      if (this.#lastNativeSequence !== undefined && sequence !== this.#lastNativeSequence + 1n) {
        throw wireError("ANDROID_USB_WIRE_ORDER", "nativeSequence måste vara sammanhängande och strikt stigande");
      }
      if (this.#lastElapsedRealtimeNanos !== undefined && time < this.#lastElapsedRealtimeNanos) {
        throw wireError("ANDROID_USB_WIRE_ORDER", "elapsedRealtimeNanos får inte minska");
      }
      this.#lastNativeSequence = sequence;
      this.#lastElapsedRealtimeNanos = time;
      this.#handleWireEvent(event);
    } catch (error) {
      const operationError = error instanceof TransportOperationError
        ? error
        : wireError("ANDROID_USB_INVALID_WIRE_DATA", errorMessage(error), error);
      this.#listeners.emitState({ status: "error", code: operationError.code, message: operationError.message });
      this.#beginAutomaticClose("error");
    }
  }

  #handleWireEvent(event: AndroidUsbWireEvent): void {
    if (event.type === "attach") return;
    if (event.type === "detach") {
      if (event.deviceId !== this.#deviceId || event.connectionId !== this.#connectionId) return;
      this.#listeners.emitState({ status: "detached", message: "USB-enheten kopplades från" });
      this.#beginAutomaticClose("detached");
      return;
    }
    if (event.connectionId !== this.#connectionId) return;
    if (event.type === "bytes") {
      const bytes = decodeCaptureBytesBase64(event.bytesBase64, "usbEvent.bytesBase64");
      if (this.#lifecycle === "opening") this.#openingRx.push(bytes);
      else if (this.#lifecycle !== "closed") this.#listeners.emitBytes(bytes);
      return;
    }
    if (event.status === "error") {
      this.#listeners.emitState({ status: "error", code: event.code, message: event.message });
      this.#beginAutomaticClose("error");
      return;
    }
    // plugin.open() resolution, not this observational event, commits open.
    if (event.status === "open") return;
    if (event.status === "closing" && this.#lifecycle !== "closed" && this.#lifecycle !== "closing") {
      this.#beginAutomaticClose("completed");
      return;
    }
    if (event.status === "closed" && this.#lifecycle !== "closed") {
      this.#nativeClosedObserved = true;
      this.#beginAutomaticClose(this.#closeReason ?? "completed");
    }
  }

  #closeFromOutside(reason: TransportCloseReason): Promise<void> {
    this.#upgradeCloseReason(reason);
    if (this.#lifecycle === "closed" && this.#openTask === undefined) return Promise.resolve();
    if (this.#closeTask !== undefined) return this.#closeTask;
    const emitClosing = this.#lifecycle !== "closing";
    this.#lifecycle = "closing";
    const generation = this.#generation;
    const connectionId = this.#connectionId;
    const task = Promise.resolve().then(() => this.#performClose(generation, connectionId));
    this.#closeTask = task;
    if (emitClosing) this.#listeners.emitState({ status: "closing", reason: this.#closeReason ?? reason });
    void task.then(
      () => { if (this.#closeTask === task) this.#closeTask = undefined; },
      () => { if (this.#closeTask === task) this.#closeTask = undefined; }
    );
    return task;
  }

  async #performClose(generation: number, connectionId: string | undefined): Promise<void> {
    let closeError: TransportOperationError | undefined;
    const cancellingOpen = !this.#nativeOpenCommitted;
    if ((this.#stopQueuedWrites || cancellingOpen) && connectionId !== undefined && this.#nativeOpenStarted) {
      closeError = await this.#tryNativeClose(connectionId);
      if (generation !== this.#generation) return;
    }

    const openTask = this.#openTask;
    if (openTask !== undefined) {
      try {
        await openTask;
      } catch {
        // open() reports its own primary error; close still owns final cleanup.
      }
    }
    if (generation !== this.#generation) return;

    await this.#writeTail;
    if (generation !== this.#generation) return;

    if (connectionId !== undefined && this.#nativeOpenStarted && !this.#nativeClosedObserved) {
      closeError = await this.#tryNativeClose(connectionId);
      if (generation !== this.#generation) return;
    }
    if (closeError !== undefined && !this.#nativeClosedObserved) {
      this.#lifecycle = "error";
      this.#closeTask = undefined;
      this.#emitOperationError(closeError);
      throw closeError;
    }

    this.#flushOpeningRx();
    const cleanupError = await this.#cleanupListener();
    if (generation !== this.#generation) return;
    if (cleanupError !== undefined) {
      this.#lifecycle = "error";
      this.#closeTask = undefined;
      this.#emitOperationError(cleanupError);
      throw cleanupError;
    }

    const finalReason = this.#closeReason ?? "completed";
    this.#lifecycle = "closed";
    this.#generation += 1;
    this.#clearConnection();
    this.#closeTask = undefined;
    this.#listeners.emitState({ status: "closed", reason: finalReason });
  }

  async #cleanupListener(): Promise<TransportOperationError | undefined> {
    const handle = this.#listenerHandle;
    this.#listenerHandle = undefined;
    if (handle === undefined) return undefined;
    const error = await this.#removeListener(handle);
    if (error !== undefined) this.#listenerHandle = handle;
    return error;
  }

  async #removeListener(handle: AndroidUsbWireListenerHandle): Promise<TransportOperationError | undefined> {
    try {
      await handle.remove();
      return undefined;
    } catch (error) {
      return wireError("ANDROID_USB_LISTENER_CLEANUP_FAILED", errorMessage(error), error);
    }
  }

  async #tryNativeClose(
    connectionId: string,
    forceAfterOpenSettlement = false
  ): Promise<TransportOperationError | undefined> {
    if (!forceAfterOpenSettlement && this.#nativeClosedObserved) return undefined;
    if (this.#nativeCloseTask !== undefined) {
      const pendingBeforeOpenSettlement = this.#nativeCloseTask;
      const pendingResult = await pendingBeforeOpenSettlement;
      if (!forceAfterOpenSettlement) return pendingResult;
      if (this.#nativeCloseTask === pendingBeforeOpenSettlement) this.#nativeCloseTask = undefined;
    }
    const task = (async (): Promise<TransportOperationError | undefined> => {
      try {
        await this.#plugin.close({ connectionId });
        this.#nativeClosedObserved = true;
        return undefined;
      } catch (error) {
        return wireError("ANDROID_USB_CLOSE_FAILED", errorMessage(error), error);
      }
    })();
    this.#nativeCloseTask = task;
    const result = await task;
    if (this.#nativeCloseTask === task) this.#nativeCloseTask = undefined;
    return result;
  }

  #beginAutomaticClose(reason: TransportCloseReason): void {
    void this.#closeFromOutside(reason).catch(() => {
      // The close path always publishes its failure as a serializable state.
    });
  }

  #emitOperationError(error: TransportOperationError): void {
    this.#listeners.emitState({ status: "error", code: error.code, message: error.message });
  }

  #upgradeCloseReason(reason: TransportCloseReason): void {
    const priority: Record<TransportCloseReason, number> = {
      initial: 0,
      completed: 1,
      requested: 2,
      detached: 3,
      error: 4
    };
    if (this.#closeReason === undefined || priority[reason] > priority[this.#closeReason]) {
      this.#closeReason = reason;
    }
    if (reason !== "requested") this.#stopQueuedWrites = true;
  }

  #flushOpeningRx(): void {
    for (const bytes of this.#openingRx.splice(0)) this.#listeners.emitBytes(bytes);
  }

  #isOpening(generation: number, connectionId: string): boolean {
    return generation === this.#generation && this.#connectionId === connectionId && this.#lifecycle === "opening";
  }

  #clearConnection(): void {
    this.#connectionId = undefined;
    this.#closeReason = undefined;
    this.#lastNativeSequence = undefined;
    this.#lastElapsedRealtimeNanos = undefined;
    this.#openingRx = [];
    this.#writeTail = Promise.resolve();
    this.#nativeOpenStarted = false;
    this.#nativeOpenCommitted = false;
    this.#nativeClosedObserved = false;
    this.#stopQueuedWrites = false;
  }
}

export interface AndroidUsbTransportContract extends ByteTransport {
  readonly kind: "android-usb";
}
