import {
  createClabUiRuntime,
  createWindowClabUiHost
} from "../host";
import { bootstrapInspectWebview } from "./inspect.webview";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapInspectWebview(runtime);
