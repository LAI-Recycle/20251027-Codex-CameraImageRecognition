import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for faces-register");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function makeCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function normaliseDescriptor(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers: number[] = [];
  for (const candidate of value) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    numbers.push(numeric);
  }
  return numbers;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = makeCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers,
    });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (_error) {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers,
    });
  }

  const label = typeof (payload as { label?: unknown }).label === "string"
    ? ((payload as { label: string }).label || "").trim()
    : "";
  const descriptors = Array.isArray((payload as { descriptors?: unknown }).descriptors)
    ? ((payload as { descriptors: unknown[] }).descriptors)
    : [];

  if (!label) {
    return new Response(JSON.stringify({ error: "label_required" }), {
      status: 400,
      headers,
    });
  }

  const rows = descriptors
    .map((descriptor) => normaliseDescriptor(descriptor))
    .filter((descriptor): descriptor is number[] => Array.isArray(descriptor) && descriptor.length > 0)
    .map((embedding) => ({ label, embedding }));

  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: "no_valid_descriptors" }), {
      status: 400,
      headers,
    });
  }

  const { error } = await supabase.from("faces").insert(rows);
  if (error) {
    console.error("faces-register insert failed", error);
    return new Response(JSON.stringify({ error: "insert_failed", details: error.message }), {
      status: 500,
      headers,
    });
  }

  return new Response(JSON.stringify({ inserted: rows.length }), {
    status: 200,
    headers,
  });
});
