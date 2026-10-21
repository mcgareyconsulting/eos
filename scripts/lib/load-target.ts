// Side-effect module: import it FIRST in an operator script
// (`import "./lib/load-target";`). Module evaluation follows import order, so
// this runs before lib/firebase/admin.ts or any other module reads the
// environment. Handles `--target sandbox|prod`; without it, loads .env.local
// exactly as the scripts always have. See ./target.ts.

import { runTargetSetup } from "./target";

export const target = runTargetSetup({ defaultEnvFile: ".env.local" });
