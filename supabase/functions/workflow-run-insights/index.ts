import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleWorkflowRunInsights } from "./handler.ts";

Deno.serve(handleWorkflowRunInsights);
