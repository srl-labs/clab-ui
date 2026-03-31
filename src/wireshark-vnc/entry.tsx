import {
  createClabUiRuntime,
  createWindowClabUiHost
} from "../host";
import { bootstrapWiresharkVncWebview } from "./index";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapWiresharkVncWebview(runtime);
