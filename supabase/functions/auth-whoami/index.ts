import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleAuthWhoAmI } from "./handler.ts";

Deno.serve(handleAuthWhoAmI);
