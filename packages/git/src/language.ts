import { basename, extname } from "node:path";

const languageByExtension: Readonly<Record<string, string>> = {
  c: "C",
  cc: "C++",
  cpp: "C++",
  cs: "C#",
  css: "CSS",
  cxx: "C++",
  dart: "Dart",
  ex: "Elixir",
  exs: "Elixir",
  fs: "F#",
  fsx: "F#",
  go: "Go",
  h: "C",
  hpp: "C++",
  html: "HTML",
  java: "Java",
  js: "JavaScript",
  jsx: "JavaScript",
  kt: "Kotlin",
  kts: "Kotlin",
  lua: "Lua",
  m: "Objective-C",
  md: "Markdown",
  php: "PHP",
  pl: "Perl",
  prisma: "Prisma",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  scala: "Scala",
  sh: "Shell",
  sql: "SQL",
  svelte: "Svelte",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TypeScript",
  vue: "Vue",
  xml: "XML",
  yaml: "YAML",
  yml: "YAML",
  zig: "Zig",
};

const languageByFilename: Readonly<Record<string, string>> = {
  dockerfile: "Dockerfile",
  gemfile: "Ruby",
  makefile: "Makefile",
  rakefile: "Ruby",
};

export function getFileExtension(path: string): string | null {
  const extension = extname(path).slice(1).toLowerCase();
  return extension || null;
}

export function detectLanguage(path: string): string | null {
  const filenameLanguage = languageByFilename[basename(path).toLowerCase()];
  if (filenameLanguage) {
    return filenameLanguage;
  }

  const extension = getFileExtension(path);
  return extension ? (languageByExtension[extension] ?? null) : null;
}
