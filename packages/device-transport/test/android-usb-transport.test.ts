import { describe, expect, it, vi } from "vitest";
import {
  AndroidUsbTransport,
  TransportOperationError,
  listAndroidUsbDevices,
  type AndroidUsbCapacitorPlugin,
  type AndroidUsbWireConnectionRequest,
  type AndroidUsbWireEvent,
  type AndroidUsbWireListenerHandle,
  type AndroidUsbWireOpenRequest,
  type AndroidUsbWirePermissionRequest,
  type AndroidUsbWirePermissionResponse,
  type AndroidUsbWireWriteRequest,
  type TransportState
} from "../src";

function deferred(): { readonly promise: Promise<void>; resolve(): void; reject(error: Error): void } {
  let resolvePromise: (() => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error)
  };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeAndroidUsbPlugin implements AndroidUsbCapacitorPlugin {
  readonly calls: string[] = [];
  readonly writes: AndroidUsbWireWriteRequest[] = [];
  readonly closes: AndroidUsbWireConnectionRequest[] = [];
  readonly writeTasks: Promise<void>[] = [];
  readonly closeTasks: Promise<void>[] = [];
  permission: unknown = { granted: true } satisfies AndroidUsbWirePermissionResponse;
  permissionTask: Promise<AndroidUsbWirePermissionResponse> | undefined;
  listenerTask: Promise<void> | undefined;
  openTask: Promise<void> | undefined;
  openHook: (() => void) | undefined;
  closeError: Error | undefined;
  removeError: Error | undefined;
  devices: unknown = {
    devices: [{ deviceId: "usb-1", vendorId: 4_292, productId: 60_000, portIndexes: [0] }]
  };
  openRequest: AndroidUsbWireOpenRequest | undefined;
  removedListeners = 0;
  removeAttempts = 0;
  readonly listenerHistory: Array<(event: AndroidUsbWireEvent) => void> = [];
  #listener: ((event: AndroidUsbWireEvent) => void) | undefined;

  async listDevices(): Promise<never> {
    this.calls.push("listDevices");
    return this.devices as never;
  }

  async requestPermission(request: AndroidUsbWirePermissionRequest): Promise<AndroidUsbWirePermissionResponse> {
    this.calls.push(`permission:${request.deviceId}`);
    return this.permissionTask === undefined
      ? this.permission as AndroidUsbWirePermissionResponse
      : await this.permissionTask;
  }

  async open(request: AndroidUsbWireOpenRequest): Promise<void> {
    this.calls.push(`open:${request.connectionId}`);
    this.openRequest = request;
    this.openHook?.();
    if (this.openTask !== undefined) await this.openTask;
  }

  async close(request: AndroidUsbWireConnectionRequest): Promise<void> {
    this.calls.push(`close:${request.connectionId}`);
    this.closes.push(request);
    if (this.closeError !== undefined) throw this.closeError;
    const task = this.closeTasks.shift();
    if (task !== undefined) await task;
  }

  async write(request: AndroidUsbWireWriteRequest): Promise<void> {
    this.calls.push(`write:${request.connectionId}`);
    this.writes.push(request);
    const task = this.writeTasks.shift();
    if (task !== undefined) await task;
  }

  async addListener(
    eventName: "usbEvent",
    listener: (event: AndroidUsbWireEvent) => void
  ): Promise<AndroidUsbWireListenerHandle> {
    this.calls.push(`listener:${eventName}`);
    this.#listener = listener;
    this.listenerHistory.push(listener);
    if (this.listenerTask !== undefined) await this.listenerTask;
    return {
      remove: async () => {
        this.removeAttempts += 1;
        if (this.removeError !== undefined) throw this.removeError;
        this.removedListeners += 1;
        this.#listener = undefined;
      }
    };
  }

  emit(event: AndroidUsbWireEvent): void {
    this.#listener?.(event);
  }

  emitUnknown(event: unknown): void {
    this.#listener?.(event as AndroidUsbWireEvent);
  }
}

function deferredPermission(): {
  readonly promise: Promise<AndroidUsbWirePermissionResponse>;
  resolve(value: AndroidUsbWirePermissionResponse): void;
} {
  let resolvePromise: ((value: AndroidUsbWirePermissionResponse) => void) | undefined;
  const promise = new Promise<AndroidUsbWirePermissionResponse>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: (value) => resolvePromise?.(value) };
}

async function waitForState(
  transport: AndroidUsbTransport,
  predicate: (state: TransportState) => boolean
): Promise<void> {
  await new Promise<void>((resolve) => {
    let matched = false;
    let unsubscribe = (): void => {};
    unsubscribe = transport.onState((state) => {
      if (!predicate(state)) return;
      matched = true;
      unsubscribe();
      resolve();
    });
    if (matched) unsubscribe();
  });
}

const configuration = Object.freeze({
  baudRate: 38_400,
  dataBits: 8 as const,
  stopBits: 1 as const,
  parity: "none" as const,
  flowControl: "none" as const
});

function createTransport(plugin: FakeAndroidUsbPlugin): AndroidUsbTransport {
  return new AndroidUsbTransport(plugin, {
    deviceId: "usb-1",
    portIndex: 0,
    configuration,
    writeTimeoutMs: 2_000,
    connectionIdFactory: () => "connection-client-1"
  });
}

describe("AndroidUsbTransport", () => {
  it("validerar enhetslistan och bevarar explicit portindex", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const devices = await listAndroidUsbDevices(plugin);

    expect(devices).toEqual([
      { deviceId: "usb-1", vendorId: 4_292, productId: 60_000, portIndexes: [0] }
    ]);
    expect(Object.isFrozen(devices)).toBe(true);
    expect(Object.isFrozen(devices[0]?.portIndexes)).toBe(true);

    plugin.devices = { devices: [{ deviceId: "usb-1", vendorId: 1, productId: 2, portIndexes: [] }] };
    await expect(listAndroidUsbDevices(plugin)).rejects.toMatchObject({ code: "ANDROID_USB_INVALID_WIRE_DATA" });
  });

  it("registrerar listener före permission och öppnar med klient-id samt full konfiguration", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));

    await transport.open();
    await transport.open();

    expect(plugin.calls).toEqual([
      "listener:usbEvent",
      "permission:usb-1",
      "open:connection-client-1"
    ]);
    expect(plugin.openRequest).toEqual({
      connectionId: "connection-client-1",
      deviceId: "usb-1",
      portIndex: 0,
      configuration
    });
    expect(states).toEqual([
      { status: "closed", reason: "initial" },
      { status: "opening" },
      { status: "open" }
    ]);
  });

  it("avvisar nekad permission och lämnar ingen aktiv listener", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    plugin.permission = { granted: false };
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));

    await expect(transport.open()).rejects.toMatchObject({ code: "ANDROID_USB_PERMISSION_DENIED" });

    expect(plugin.openRequest).toBeUndefined();
    expect(plugin.closes).toEqual([]);
    expect(plugin.removedListeners).toBe(1);
    expect(states).toContainEqual({
      status: "error",
      code: "ANDROID_USB_PERMISSION_DENIED",
      message: "USB-behörighet nekades"
    });
    expect(states.at(-1)).toEqual({ status: "closed", reason: "error" });
  });

  it("filtrerar främmande events och kopierar råbytes per lyssnare", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];
    transport.onBytes((bytes) => {
      first.push(bytes);
      bytes[0] = 255;
    });
    transport.onBytes((bytes) => second.push(bytes));
    await transport.open();

    plugin.emit({
      type: "bytes",
      connectionId: "foreign",
      nativeSequence: "9007199254740993",
      elapsedRealtimeNanos: "9223372036854775800",
      bytesBase64: "CQ=="
    });
    plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "9007199254740994",
      elapsedRealtimeNanos: "9223372036854775807",
      bytesBase64: "AQID"
    });

    expect(first).toHaveLength(1);
    expect([...second[0] ?? []]).toEqual([1, 2, 3]);
  });

  it("serialiserar writes, väntar på native completion och kopierar input", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const firstWrite = deferred();
    plugin.writeTasks.push(firstWrite.promise, Promise.resolve());
    const transport = createTransport(plugin);
    await transport.open();

    const input = new Uint8Array([1, 2, 3]);
    const first = transport.write(input);
    input[0] = 9;
    const second = transport.write(new Uint8Array([4]));
    await flushTasks();

    expect(plugin.writes).toEqual([{
      connectionId: "connection-client-1",
      bytesBase64: "AQID",
      writeTimeoutMs: 2_000
    }]);
    firstWrite.resolve();
    await first;
    await second;
    expect(plugin.writes.map((write) => write.bytesBase64)).toEqual(["AQID", "BA=="]);
  });

  it("stänger explicit och idempotent efter väntande writes", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const pendingWrite = deferred();
    plugin.writeTasks.push(pendingWrite.promise);
    const transport = createTransport(plugin);
    await transport.open();
    const write = transport.write(new Uint8Array([1]));
    const close = transport.close();
    await flushTasks();
    expect(plugin.closes).toHaveLength(0);

    pendingWrite.resolve();
    await write;
    await close;
    await transport.close();

    expect(plugin.closes).toEqual([{ connectionId: "connection-client-1" }]);
    expect(plugin.removedListeners).toBe(1);
  });

  it("gör ogiltig wiredata till explicit fel och stänger anslutningen", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();

    plugin.emitUnknown({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      bytesBase64: "inte-base64"
    });
    await flushTasks();

    expect(states.some((state) => state.status === "error" && state.code === "ANDROID_USB_INVALID_WIRE_DATA")).toBe(true);
    expect(plugin.closes).toEqual([{ connectionId: "connection-client-1" }]);
  });

  it("avvisar bakåtgående nativeordning utan att tolka byteinnehållet", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();

    plugin.emit({
      type: "bytes",
      connectionId: "foreign",
      nativeSequence: "2",
      elapsedRealtimeNanos: "200",
      bytesBase64: "Ag=="
    });
    plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "201",
      bytesBase64: "Ag=="
    });
    await flushTasks();

    expect(states.some((state) => state.status === "error" && state.code === "ANDROID_USB_WIRE_ORDER")).toBe(true);
  });

  it("rapporterar detach och frigör den aktiva anslutningen exakt en gång", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();

    plugin.emit({
      type: "detach",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      deviceId: "usb-1"
    });
    await waitForState(transport, (state) => state.status === "closed" && state.reason === "detached");

    expect(states).toContainEqual({ status: "detached", message: "USB-enheten kopplades från" });
    expect(states).toContainEqual({ status: "closed", reason: "detached" });
    expect(plugin.closes).toEqual([{ connectionId: "connection-client-1" }]);
  });

  it("propagerar write-fel utan råbytes i felmeddelandet", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    plugin.writeTasks.push(Promise.reject(new Error("native write failed")));
    const transport = createTransport(plugin);
    await transport.open();

    const write = transport.write(new Uint8Array([222, 173, 190, 239]));
    await expect(write).rejects.toEqual(
      expect.objectContaining<Partial<TransportOperationError>>({
        code: "ANDROID_USB_WRITE_FAILED",
        message: "native write failed"
      })
    );
    await flushTasks();
    expect(plugin.closes).toEqual([{ connectionId: "connection-client-1" }]);
  });

  it("buffrar RX som kommer inuti native open och flushar efter fysisk open-commit", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const chunks: number[][] = [];
    const states: TransportState[] = [];
    transport.onBytes((bytes) => chunks.push([...bytes]));
    transport.onState((state) => states.push(state));
    plugin.openHook = () => plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      bytesBase64: "AQID"
    });

    await transport.open();

    expect(chunks).toEqual([[1, 2, 3]]);
    expect(states.map((state) => state.status)).toEqual(["closed", "opening", "open"]);
  });

  it("bevarar redan mottagen RX även när native open därefter misslyckas", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const nativeOpen = deferred();
    plugin.openTask = nativeOpen.promise;
    const transport = createTransport(plugin);
    const chunks: number[][] = [];
    transport.onBytes((bytes) => chunks.push([...bytes]));
    plugin.openHook = () => plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      bytesBase64: "BAU="
    });

    const opening = transport.open();
    await flushTasks();
    nativeOpen.reject(new Error("open boom"));
    await expect(opening).rejects.toMatchObject({ code: "ANDROID_USB_OPEN_FAILED" });

    expect(chunks).toEqual([[4, 5]]);
  });

  it("avbryter före native open när close sker under permission", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const permission = deferredPermission();
    plugin.permissionTask = permission.promise;
    const transport = createTransport(plugin);

    const opening = transport.open();
    await flushTasks();
    const closing = transport.close();
    permission.resolve({ granted: true });

    await expect(opening).rejects.toMatchObject({ code: "ANDROID_USB_OPEN_CANCELLED" });
    await closing;
    expect(plugin.openRequest).toBeUndefined();
    expect(plugin.closes).toEqual([]);
    expect(plugin.removedListeners).toBe(1);
  });

  it("avbryter och städar en listener som resolve:ar efter close", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const listenerRegistration = deferred();
    plugin.listenerTask = listenerRegistration.promise;
    const transport = createTransport(plugin);

    const opening = transport.open();
    await flushTasks();
    const closing = transport.close();
    listenerRegistration.resolve();

    await expect(opening).rejects.toMatchObject({ code: "ANDROID_USB_OPEN_CANCELLED" });
    await closing;
    expect(plugin.removedListeners).toBe(1);
    expect(plugin.openRequest).toBeUndefined();
  });

  it("gör en ny best-effort close efter att avbruten native open har hunnit resolve", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const nativeOpen = deferred();
    plugin.openTask = nativeOpen.promise;
    const transport = createTransport(plugin);

    const opening = transport.open();
    await flushTasks();
    expect(plugin.openRequest).toBeDefined();
    const closing = transport.close();
    await flushTasks();
    expect(plugin.closes).toHaveLength(1);

    nativeOpen.resolve();
    await expect(opening).rejects.toMatchObject({ code: "ANDROID_USB_OPEN_CANCELLED" });
    await closing;
    expect(plugin.closes.length).toBeGreaterThanOrEqual(2);
  });

  it("väntar ut överlappande pre-open-close och gör ett nytt close efter open-settlement", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const nativeOpen = deferred();
    const earlyClose = deferred();
    plugin.openTask = nativeOpen.promise;
    plugin.closeTasks.push(earlyClose.promise, Promise.resolve());
    const transport = createTransport(plugin);

    const opening = transport.open();
    await flushTasks();
    const closing = transport.close();
    await flushTasks();
    expect(plugin.closes).toHaveLength(1);

    nativeOpen.resolve();
    await flushTasks();
    expect(plugin.closes).toHaveLength(1);
    earlyClose.resolve();

    await expect(opening).rejects.toMatchObject({ code: "ANDROID_USB_OPEN_CANCELLED" });
    await closing;
    expect(plugin.closes).toHaveLength(2);
  });

  it("detekterar gap i nativeSequence som möjlig eventförlust", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      bytesBase64: "AQ=="
    });
    plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "3",
      elapsedRealtimeNanos: "101",
      bytesBase64: "Ag=="
    });

    await waitForState(transport, (state) => state.status === "closed" && state.reason === "error");
    expect(states).toContainEqual({
      status: "error",
      code: "ANDROID_USB_WIRE_ORDER",
      message: "nativeSequence måste vara sammanhängande och strikt stigande"
    });
  });

  it("ignorerar callbacks från föregående listener efter reopen", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const ids = ["connection-1", "connection-2"];
    const transport = new AndroidUsbTransport(plugin, {
      deviceId: "usb-1",
      portIndex: 0,
      configuration,
      writeTimeoutMs: 2_000,
      connectionIdFactory: () => ids.shift() ?? "unexpected"
    });
    const chunks: number[][] = [];
    transport.onBytes((bytes) => chunks.push([...bytes]));
    await transport.open();
    const staleListener = plugin.listenerHistory[0];
    await transport.close();
    await transport.open();

    staleListener?.({
      type: "bytes",
      connectionId: "connection-1",
      nativeSequence: "999",
      elapsedRealtimeNanos: "999",
      bytesBase64: "CQ=="
    });
    plugin.emit({
      type: "bytes",
      connectionId: "connection-2",
      nativeSequence: "1",
      elapsedRealtimeNanos: "1",
      bytesBase64: "Bw=="
    });

    expect(chunks).toEqual([[7]]);
    await transport.close();
  });

  it("stoppar köade writes efter första write-felet", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const firstWrite = deferred();
    plugin.writeTasks.push(firstWrite.promise, Promise.resolve());
    const transport = createTransport(plugin);
    await transport.open();
    const first = transport.write(new Uint8Array([1]));
    const second = transport.write(new Uint8Array([2]));
    firstWrite.reject(new Error("write boom"));

    await expect(first).rejects.toMatchObject({ code: "ANDROID_USB_WRITE_FAILED" });
    await expect(second).rejects.toMatchObject({ code: "ANDROID_USB_WRITE_CANCELLED" });
    await waitForState(transport, (state) => state.status === "closed" && state.reason === "error");
    expect(plugin.writes.map((write) => write.bytesBase64)).toEqual(["AQ=="]);
  });

  it("serialiserar native closed med en väntande write och stänger först när write är avgjord", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const pendingWrite = deferred();
    plugin.writeTasks.push(pendingWrite.promise);
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();
    const write = transport.write(new Uint8Array([1]));
    await flushTasks();
    plugin.emit({
      type: "state",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      status: "closed",
      code: null,
      message: null
    });
    await flushTasks();
    expect(states.at(-1)?.status).toBe("closing");

    pendingWrite.resolve();
    await write;
    await waitForState(transport, (state) => state.status === "closed" && state.reason === "completed");
    expect(plugin.closes).toEqual([]);
  });

  it("bevarar RX fram till fysisk close under requested write-drain", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const pendingWrite = deferred();
    plugin.writeTasks.push(pendingWrite.promise);
    const transport = createTransport(plugin);
    const chunks: number[][] = [];
    transport.onBytes((bytes) => chunks.push([...bytes]));
    await transport.open();
    const write = transport.write(new Uint8Array([1]));
    const closing = transport.close();
    await flushTasks();
    plugin.emit({
      type: "bytes",
      connectionId: "connection-client-1",
      nativeSequence: "1",
      elapsedRealtimeNanos: "100",
      bytesBase64: "CAk="
    });

    expect(chunks).toEqual([[8, 9]]);
    pendingWrite.resolve();
    await write;
    await closing;
  });

  it("isolerar kastande konsumenthandlers från andra lyssnare och livscykeln", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const plugin = new FakeAndroidUsbPlugin();
      const transport = createTransport(plugin);
      const chunks: number[][] = [];
      transport.onState(() => { throw new Error("state consumer boom"); });
      transport.onBytes(() => { throw new Error("byte consumer boom"); });
      transport.onBytes((bytes) => chunks.push([...bytes]));

      await transport.open();
      plugin.emit({
        type: "bytes",
        connectionId: "connection-client-1",
        nativeSequence: "1",
        elapsedRealtimeNanos: "100",
        bytesBase64: "AQI="
      });
      await transport.close();

      expect(chunks).toEqual([[1, 2]]);
      expect(report).toHaveBeenCalled();
    } finally {
      report.mockRestore();
    }
  });

  it("bevarar primärt open-fel när listener cleanup först misslyckas och kan retry-städa", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    plugin.permission = { granted: false };
    plugin.removeError = new Error("remove boom");
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));

    await expect(transport.open()).rejects.toMatchObject({ code: "ANDROID_USB_PERMISSION_DENIED" });
    expect(states).toContainEqual({
      status: "error",
      code: "ANDROID_USB_LISTENER_CLEANUP_FAILED",
      message: "remove boom"
    });
    plugin.removeError = undefined;
    await transport.close();
    expect(plugin.removeAttempts).toBe(2);
    expect(states.at(-1)).toEqual({ status: "closed", reason: "error" });
  });

  it("validerar permission strikt och avvisar tvetydig flow control", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    plugin.permission = { granted: "yes" };
    const transport = createTransport(plugin);
    await expect(transport.open()).rejects.toMatchObject({ code: "ANDROID_USB_INVALID_WIRE_DATA" });

    const pluginWithExtra = new FakeAndroidUsbPlugin();
    pluginWithExtra.permission = { granted: true, extra: true };
    await expect(createTransport(pluginWithExtra).open()).rejects.toMatchObject({
      code: "ANDROID_USB_INVALID_WIRE_DATA"
    });

    let configurationError: unknown;
    try {
      new AndroidUsbTransport(plugin, {
        deviceId: "usb-1",
        portIndex: 0,
        configuration: { ...configuration, flowControl: "hardware" } as never,
        writeTimeoutMs: 2_000
      });
    } catch (error) {
      configurationError = error;
    }
    expect(configurationError).toMatchObject({ code: "ANDROID_USB_INVALID_CONFIGURATION" });
  });

  it("avvisar detach utan aktivt connectionId", async () => {
    const plugin = new FakeAndroidUsbPlugin();
    const transport = createTransport(plugin);
    const states: TransportState[] = [];
    transport.onState((state) => states.push(state));
    await transport.open();

    plugin.emitUnknown({
      type: "detach",
      connectionId: null,
      nativeSequence: "1",
      elapsedRealtimeNanos: "1",
      deviceId: "usb-1"
    });
    await waitForState(transport, (state) => state.status === "closed" && state.reason === "error");

    expect(states).toContainEqual(expect.objectContaining({
      status: "error",
      code: "ANDROID_USB_INVALID_WIRE_DATA"
    }));
  });
});
