import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleTrackRunTelemetry } from "./handler.ts";

Deno.serve(handleTrackRunTelemetry);
