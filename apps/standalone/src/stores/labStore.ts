import { create } from "zustand";

export interface ContainerState {
  name: string;
  containerId: string;
  labName: string;
  labPath: string;
  owner: string;
  nodeName: string;
  kind: string;
  image: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  interfaces: Map<string, InterfaceState>;
}

export interface InterfaceState {
  name: string;
  alias: string;
  state: string;
  type: string;
  mac: string;
  mtu: string;
  ifIndex?: string;
  rxBps?: string;
  txBps?: string;
  rxPps?: string;
  txPps?: string;
  rxBytes?: string;
  txBytes?: string;
  rxPackets?: string;
  txPackets?: string;
  statsIntervalSeconds?: string;
  netemDelay?: string;
  netemJitter?: string;
  netemLoss?: string;
  netemRate?: string;
  netemCorruption?: string;
}

export interface LabState {
  name: string;
  owner: string;
  containers: Map<string, ContainerState>;
}

interface LabStoreState {
  labs: Map<string, LabState>;
  connected: boolean;
  setConnected: (connected: boolean) => void;
  processEvent: (event: EventData) => void;
  clear: () => void;
}

export interface EventData {
  time?: number;
  type: string;
  action: string;
  attributes: Record<string, string>;
}

function extractContainerState(attrs: Record<string, string>): ContainerState {
  return {
    name: attrs.name ?? "",
    containerId: attrs["container-id"] ?? attrs.id ?? attrs.name ?? "",
    labName: attrs.lab ?? attrs.containerlab ?? "",
    labPath: attrs["lab-path"] ?? attrs["clab-topo-file"] ?? "",
    owner: attrs["clab-owner"] ?? attrs.owner ?? "",
    nodeName: attrs["clab-node-name"] ?? "",
    kind: attrs["clab-node-kind"] ?? "",
    image: attrs.image ?? "",
    state: attrs.state ?? "running",
    status: attrs.status ?? "",
    ipv4Address: attrs["ipv4-address"] ?? attrs.mgmt_ipv4 ?? "N/A",
    ipv6Address: attrs["ipv6-address"] ?? attrs.mgmt_ipv6 ?? "N/A",
    interfaces: new Map()
  };
}

function upsertInterface(
  container: ContainerState,
  attrs: Record<string, string>,
  action: string
): void {
  const interfaceName = attrs.ifname ?? "";
  if (!interfaceName) return;
  if (interfaceName.startsWith("clab-")) {
    container.interfaces.delete(interfaceName);
    return;
  }
  if (action === "delete") {
    container.interfaces.delete(interfaceName);
    return;
  }

  const existing = container.interfaces.get(interfaceName);
  const next: InterfaceState = {
    name: interfaceName,
    alias: attrs.alias ?? existing?.alias ?? "",
    state: attrs.state ?? existing?.state ?? "",
    type: attrs.type ?? existing?.type ?? "",
    mac: attrs.mac ?? existing?.mac ?? "",
    mtu: attrs.mtu ?? existing?.mtu ?? "",
    ifIndex: attrs.index ?? existing?.ifIndex,
    rxBps: attrs.rx_bps ?? existing?.rxBps,
    txBps: attrs.tx_bps ?? existing?.txBps,
    rxPps: attrs.rx_pps ?? existing?.rxPps,
    txPps: attrs.tx_pps ?? existing?.txPps,
    rxBytes: attrs.rx_bytes ?? existing?.rxBytes,
    txBytes: attrs.tx_bytes ?? existing?.txBytes,
    rxPackets: attrs.rx_packets ?? existing?.rxPackets,
    txPackets: attrs.tx_packets ?? existing?.txPackets,
    statsIntervalSeconds: attrs.interval_seconds ?? existing?.statsIntervalSeconds,
    netemDelay: attrs.netem_delay ?? existing?.netemDelay,
    netemJitter: attrs.netem_jitter ?? existing?.netemJitter,
    netemLoss: attrs.netem_loss ?? existing?.netemLoss,
    netemRate: attrs.netem_rate ?? existing?.netemRate,
    netemCorruption: attrs.netem_corruption ?? existing?.netemCorruption
  };

  if (action === "stats") {
    next.alias = existing?.alias ?? next.alias;
    next.type = existing?.type ?? next.type;
    next.mac = existing?.mac ?? next.mac;
    next.mtu = existing?.mtu ?? next.mtu;
  }

  container.interfaces.set(interfaceName, next);
}

export const useLabStore = create<LabStoreState>((set, get) => ({
  labs: new Map(),
  connected: false,

  setConnected: (connected) => set({ connected }),

  processEvent: (event) => {
    const attrs = event.attributes;
    const labName = attrs.lab || attrs.containerlab;
    if (!labName) return;

    const previousLabs = get().labs;
    const labs = new Map(previousLabs);
    const existingLab = previousLabs.get(labName);
    const lab: LabState = existingLab
      ? { name: existingLab.name, owner: existingLab.owner, containers: new Map(existingLab.containers) }
      : { name: labName, owner: attrs["clab-owner"] ?? attrs.owner ?? "", containers: new Map() };

    const containerName = attrs.name ?? "";
    if (!containerName) return;
    const action = event.action;

    if (event.type === "container") {
      if (action === "destroy" || action === "die" || action === "kill") {
        lab.containers.delete(containerName);
        // If no containers left, remove the lab
        if (lab.containers.size === 0) {
          labs.delete(labName);
        } else {
          labs.set(labName, lab);
        }
      } else {
        // start, create, running, health_status, etc.
        const incoming = extractContainerState(attrs);
        const existing = lab.containers.get(containerName);
        const container = {
          ...(existing ?? incoming),
          ...incoming,
          interfaces: new Map(existing?.interfaces ?? incoming.interfaces)
        };
        if (incoming.owner) {
          lab.owner = incoming.owner;
        }
        lab.containers.set(containerName, container);
        labs.set(labName, lab);
      }
    } else if (event.type === "interface") {
      const existing = lab.containers.get(containerName);
      const placeholder = extractContainerState(attrs);
      const container: ContainerState = existing
        ? { ...existing, interfaces: new Map(existing.interfaces) }
        : placeholder;
      upsertInterface(container, attrs, action);
      lab.containers.set(containerName, container);
      labs.set(labName, lab);
    }

    set({ labs });
  },

  clear: () => set({ labs: new Map(), connected: false })
}));
