// Tell TypeScript that `import x from "*.html"` resolves to a string.
// esbuild's `--loader:.html=text` flag inlines the HTML file's contents as
// a string at bundle time; this declaration just makes the editor + tsc
// stop complaining about it.
declare module "*.html" {
  const content: string;
  export default content;
}
