import { SerialPort } from "serialport";

import type { SerialDriver, SerialPortHandle, SerialPortOpenOptions } from "./node-serial-transport.js";

export const serialPortDriver: SerialDriver = {
  list: async () => SerialPort.list(),
  create(options: SerialPortOpenOptions): SerialPortHandle {
    return new SerialPort(options) as SerialPortHandle;
  }
};
