import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleWorkflowAnalytics } from "./handler.ts";

Deno.serve(handleWorkflowAnalytics);
