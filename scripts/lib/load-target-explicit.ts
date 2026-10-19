// Side-effect module for scripts with no default target: import it FIRST.
// Requires `--target sandbox|prod` or `--env-file <path>`, and exits 1 when
// neither is given. See ./target.ts.

import { runTargetSetup } from "./target";

export const target = runTargetSetup({ defaultEnvFile: ".env.local", requireExplicit: true });
