let mermaid;
try {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", flowchart: { htmlLabels: false } });
} catch {
  process.stdout.write(`${JSON.stringify({ status: "unverified", reason: "Mermaid parser dependencies are unavailable." })}\n`);
  process.exit(0);
}
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const result = await mermaid.parse(input);
  process.stdout.write(`${JSON.stringify({ status: result ? "valid" : "invalid" })}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ status: "invalid", reason: "Generated Mermaid did not pass grammar validation." })}\n`);
}