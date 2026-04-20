import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCreateCliToken } from "./handler.ts";

Deno.serve(handleCreateCliToken);
