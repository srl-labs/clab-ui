import { assertClabUiHostConfigured } from "../host";
import { bootstrapContainerlabExplorerView } from "./containerlabExplorerView.webview";

assertClabUiHostConfigured();

bootstrapContainerlabExplorerView();
