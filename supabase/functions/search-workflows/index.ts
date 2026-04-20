import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleSearchWorkflows } from "./handler.ts";

Deno.serve(handleSearchWorkflows);
