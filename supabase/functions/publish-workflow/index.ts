import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handlePublishWorkflow } from "./handler.ts";

Deno.serve(handlePublishWorkflow);
