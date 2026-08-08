import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleWorkflowObservability } from "./handler.ts";

Deno.serve(handleWorkflowObservability);
