import {
  createClabUiRuntime,
  createWindowClabUiHost
} from "../host";
import { bootstrapContainerlabExplorerView } from "./containerlabExplorerView.webview";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapContainerlabExplorerView(runtime);
