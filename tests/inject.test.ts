import { describe, expect, test } from "vitest";
import { DATA_ATTR } from "../src/shared/constants.js";
import { injectBridge } from "../src/cli/inject.js";

const BRIDGE_MARK = new RegExp(`${DATA_ATTR}="bridge"`, "g");
const BASE_MARK = /<base[^>]*\/asset\/[^>]*>/i;

describe("injectBridge — bridge script injected exactly once", () => {
  test.each<[string, string]>([
    ["normal", `<html><head><title>x</title></head><body>hi</body></html>`],
    ["no </head> tag", `<html><head><title>x<body>hi</body></html>`],
    ["no <head> at all", `<html><body>hi</body></html>`],
    ["no <html> at all", `hi`],
    ["fragment only", `<p>fragment</p>`],
    ["existing <base>", `<html><head><base href="/x/"></head><body></body></html>`],
    ["uppercase HEAD", `<HTML><HEAD></HEAD><BODY></BODY></HTML>`],
    [
      "<header> must NOT be mistaken for <head>",
      `<html><body><header>nav</header><p>x</p></body></html>`,
    ],
    [
      "<headline> must NOT be mistaken for <head>",
      `<html><body><headline>title</headline></body></html>`,
    ],
  ])("%s", (_, input) => {
    const out = injectBridge(input, "test12345678");
    const matches = out.match(BRIDGE_MARK) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe("injectBridge — base href behavior", () => {
  test("injects <base href=\"/asset/<id>/\"> when none present", () => {
    const out = injectBridge(`<html><head></head><body></body></html>`, "test12345678");
    expect(out).toMatch(BASE_MARK);
    expect(out).toContain(`<base href="/asset/test12345678/">`);
  });

  test("sanitizes the session id used in the base href", () => {
    // Defense in depth: even though hashFor() produces clean hex, an
    // external caller passing a malicious string shouldn't be able to
    // inject HTML through this seam.
    const out = injectBridge(
      `<html><head></head><body></body></html>`,
      'x"><script>alert(1)</script>',
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toMatch(/<base href="\/asset\/x[^"]*\/">/);
  });

  test("respects an existing <base>", () => {
    const input = `<html><head><base href="/existing/"></head><body></body></html>`;
    const out = injectBridge(input, "test12345678");
    // Original base survives; we don't add a second one.
    expect(out).toContain(`<base href="/existing/">`);
    expect(out).not.toContain(`<base href="/asset/">`);
  });

  test("does NOT mistake <basement> for <base>", () => {
    const input = `<html><head></head><body><basement>x</basement></body></html>`;
    const out = injectBridge(input, "test12345678");
    // Should inject /asset/ base since <basement> isn't <base>.
    expect(out).toMatch(BASE_MARK);
  });
});

describe("injectBridge — placement", () => {
  test("bridge sits before </head> when </head> exists", () => {
    const out = injectBridge(`<html><head><title>x</title></head><body></body></html>`, "test12345678");
    const bridgeIdx = out.search(BRIDGE_MARK);
    const closeHeadIdx = out.indexOf(`</head>`);
    expect(bridgeIdx).toBeGreaterThan(-1);
    expect(closeHeadIdx).toBeGreaterThan(-1);
    expect(bridgeIdx).toBeLessThan(closeHeadIdx);
  });

  test("output remains parseable as HTML (well-formed wrapper for fragment input)", () => {
    const out = injectBridge(`hi`, "test12345678");
    expect(out).toMatch(/<html>/i);
    expect(out).toMatch(/<\/html>/i);
    expect(out).toMatch(/<body>hi<\/body>/i);
  });
});
