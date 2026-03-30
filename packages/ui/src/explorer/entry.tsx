import { createWindowClabUiHost, setClabUiHost } from "../host";

setClabUiHost(createWindowClabUiHost());

void import("./containerlabExplorerView.webview");
