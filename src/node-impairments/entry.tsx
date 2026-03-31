import {
  createClabUiRuntime,
  createWindowClabUiHost
} from "../host";
import { bootstrapNodeImpairmentsWebview } from "./index";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapNodeImpairmentsWebview(runtime);
