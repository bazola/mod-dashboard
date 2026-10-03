// The worldserver-hosted UI has no lifecycle backend. HTML 404s are normal there.
export async function hasServerControl(fetcher = fetch) {
  try {
    const response = await fetcher("host-health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return false;
    const body = await response.json();
    return body?.ok === true && body.control === true;
  } catch { return false; }
}
