import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleRevokeCliToken } from "./handler.ts";

Deno.serve(handleRevokeCliToken);
