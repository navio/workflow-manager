import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleListCliTokens } from "./handler.ts";

Deno.serve(handleListCliTokens);
