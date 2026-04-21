import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleRefreshWorkflowStats } from "./handler.ts";

Deno.serve(handleRefreshWorkflowStats);
