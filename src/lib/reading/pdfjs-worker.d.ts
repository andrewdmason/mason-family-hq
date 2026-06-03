// pdfjs ships no types for the worker subpath. We import it only to register
// it on globalThis.pdfjsWorker (see convert.ts), so an opaque module is enough.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
