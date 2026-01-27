// Type declarations for embedded file imports
// Bun's `with { type: "file" }` returns the file path as a string

declare module "*.md" {
  const path: string
  export default path
}
