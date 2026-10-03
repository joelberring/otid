import { listSerialPorts, type SerialDriver, type SerialPortInfo } from "./node-serial-transport.js";

function publicPortInfo(port: SerialPortInfo): Record<string, string | null> {
  return {
    path: port.path,
    manufacturer: port.manufacturer ?? null,
    vendorId: port.vendorId ?? null,
    productId: port.productId ?? null
  };
}

export async function runPortsCommand(driver: SerialDriver): Promise<string> {
  const ports = await listSerialPorts(driver);
  return JSON.stringify({
    opened: false,
    probed: false,
    sportidentSupportClaimed: false,
    count: ports.length,
    ports: ports.map(publicPortInfo)
  });
}
