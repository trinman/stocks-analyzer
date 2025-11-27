// FIX: The original `declare var process` was causing a redeclaration error because `process`
// is already defined globally (likely via @types/node). Changed to augment the existing
// `NodeJS.ProcessEnv` interface to add the `API_KEY` type, which is the correct way to
// extend `process.env` without conflicts.
declare namespace NodeJS {
  interface ProcessEnv {
    API_KEY?: string;
  }
}
