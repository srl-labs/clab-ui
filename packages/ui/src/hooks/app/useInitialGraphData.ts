/**
 * Initial bootstrap data type for the App entry.
 *
 * Topology state now comes from TopologyHost snapshots; this shape
 * represents only non-topology bootstrap data injected by the host.
 */
import type { CustomNodeTemplate, SchemaData } from "@srl-labs/clab-ui/core/schema";
import type { CustomIconInfo } from "@srl-labs/clab-ui/core/types/icons";

export interface InitialGraphData {
  schemaData?: SchemaData;
  dockerImages?: string[];
  customNodes?: CustomNodeTemplate[];
  defaultNode?: string;
  customIcons?: CustomIconInfo[];
}
