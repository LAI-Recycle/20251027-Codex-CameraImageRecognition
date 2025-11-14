import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for faces-list");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function makeCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  });

  if (!origin) {
    headers.set("Access-Control-Allow-Origin", "*");
    return headers;
  }

  if (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return headers;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = makeCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers,
    });
  }

  const { data, error } = await supabase
    .from("faces")
    .select("id, label, embedding, created_at")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error("faces-list query failed", error);
    return new Response(JSON.stringify({ error: "query_failed", details: error.message }), {
      status: 500,
      headers,
    });
  }

  return new Response(
    JSON.stringify({ faces: data ?? [] }),
    {
      status: 200,
      headers,
    },
  );
});
