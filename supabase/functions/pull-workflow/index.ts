import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePullWorkflow } from "./handler.ts";

Deno.serve(handlePullWorkflow);
