import {
  createClabUiRuntime,
  createWindowClabUiHost
} from "../host";
import { bootstrapWelcomePage } from "./index";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

bootstrapWelcomePage(runtime);
