import assert from "node:assert/strict";

const origin = process.argv[2] || "http://localhost:3000";
const canonicalOrigin = process.argv[3] || origin;
for (const route of ["/", "/demo"]) {
  const response = await fetch(new URL(route, origin));
  assert.equal(response.status, 200, `${route} should render`);
}
const anonymous = await fetch(new URL("/api/budget/families", origin));
assert.equal(anonymous.status, 401, "Anonymous users must not read family data");
assert.equal((await anonymous.json()).error, "signInRequired");
const external = await fetch(new URL("/api/budget/families", origin), {
  method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Smoke test", currency: "ILS" })
});
assert.equal(external.status, 403, "Cross-origin writes must be denied");
const sameOrigin = await fetch(new URL("/api/budget/families", origin), {
  method: "POST", headers: { Origin: canonicalOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Smoke test", currency: "ILS" })
});
assert.equal(sameOrigin.status, 401, "Same-origin writes still require authentication");
const planWrite = await fetch(new URL("/api/budget/families/test/plans", origin), {
  method: "POST", headers: { Origin: canonicalOrigin, "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Test plan", totalMinor: 360000, paymentCount: 12, firstDate: "2026-10-15" })
});
assert.equal(planWrite.status, 401, "Creating payment plans requires authentication");
console.log("HTTP checks passed: pages render; anonymous reads/writes and cross-origin writes are blocked. No database records were created.");
