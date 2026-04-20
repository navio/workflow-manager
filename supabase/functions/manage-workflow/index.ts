import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleManageWorkflow } from "./handler.ts";

Deno.serve(handleManageWorkflow);
