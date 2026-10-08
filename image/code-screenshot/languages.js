/*
 * Languages offered by Code Screenshot (Prism component ids) and a small heuristic detector.

 *
 * detect(code) scores each language by weighted regex hits and returns the best id ('plain' when
 * nothing stands out). It only has to be right for typical snippets; the picker overrides it.
 */
export const LANGS = [
  ["javascript", "JavaScript", "js"],
  ["typescript", "TypeScript", "ts"],
  ["jsx", "JSX", "jsx"],
  ["tsx", "TSX", "tsx"],
  ["python", "Python", "py"],
  ["java", "Java", "java"],
  ["kotlin", "Kotlin", "kt"],
  ["swift", "Swift", "swift"],
  ["c", "C", "c"],
  ["cpp", "C++", "cpp"],
  ["csharp", "C#", "cs"],
  ["go", "Go", "go"],
  ["rust", "Rust", "rs"],
  ["ruby", "Ruby", "rb"],
  ["php", "PHP", "php"],
  ["dart", "Dart", "dart"],
  ["lua", "Lua", "lua"],
  ["bash", "Shell", "sh"],
  ["powershell", "PowerShell", "ps1"],
  ["sql", "SQL", "sql"],
  ["markup", "HTML / XML", "html"],
  ["css", "CSS", "css"],
  ["scss", "SCSS", "scss"],
  ["json", "JSON", "json"],
  ["yaml", "YAML", "yml"],
  ["toml", "TOML", "toml"],
  ["markdown", "Markdown", "md"],
  ["docker", "Dockerfile", "Dockerfile"],
  ["diff", "Diff", "diff"],
  ["graphql", "GraphQL", "graphql"],
  ["plain", "Plain text", "txt"],
];
export const langName = (id) => LANGS.find((l) => l[0] === id)?.[1] || id;
export const langExt = (id) => LANGS.find((l) => l[0] === id)?.[2] || "txt";

// [language, regex, weight]
const RULES = [
  ["json", /^\s*[[{][\s\S]*[\]}]\s*$/, 2],
  ["json", /^\s*"[^"]+"\s*:\s*/m, 3],
  ["json", /\b(function|const|let|var)\b/, -6],
  [
    "markup",
    /^\s*<(!doctype|html|\?xml|div|span|svg|head|body|p|a|ul|section)\b/im,
    6,
  ],
  ["markup", /<\/[a-z][\w-]*>/i, 3],
  ["jsx", /return\s*\(\s*<[A-Za-z]/, 6],
  ["jsx", /<[A-Z]\w*(\s+\w+=|\s*\/?>)/, 3],
  ["jsx", /className=/, 4],
  ["tsx", /<[A-Z]\w*[\s/>][\s\S]*:\s*(string|number|React\.\w+)/, 3],
  ["typescript", /:\s*(string|number|boolean|void|any|unknown|never)\b/, 4],
  ["typescript", /\b(interface|type)\s+[A-Z]\w*\s*[={<]/, 5],
  ["typescript", /\b(as const|readonly|implements|enum)\b/, 2],
  ["typescript", /<[A-Z]\w*>\(/, 1],
  ["typescript", /<[A-Z]\w*\s+extends\s/, 4],
  ["typescript", /\w:\s*[A-Z]\w*(<[^>\n]*>)?(\[\])?\s*[;,)=]/, 2],
  ["javascript", /\b(const|let|var)\s+\w+\s*=/, 2],
  ["javascript", /=>\s*[{(]?/, 2],
  ["javascript", /\bfunction\s*\w*\s*\(/, 2],
  [
    "javascript",
    /\b(console\.log|document\.|window\.|require\(|module\.exports|export default|import .* from)\b/,
    3,
  ],
  ["python", /^\s*def\s+\w+\(.*\)\s*(->\s*[\w[\], ]+)?:\s*$/m, 6],
  ["python", /^\s*(from\s+[\w.]+\s+)?import\s+\w+/m, 2],
  [
    "python",
    /\bself\b|\bprint\(|\belif\b|__name__|\bNone\b|\bTrue\b|\bFalse\b/,
    3,
  ],
  ["python", /^\s*class\s+\w+(\(.*\))?:\s*$/m, 4],
  ["java", /\bpublic\s+(static\s+)?(final\s+)?(class|void|int|String)\b/, 5],
  ["java", /System\.out\.println|@Override|\bpackage\s+[\w.]+;/, 5],
  ["kotlin", /\bfun\s+\w+\s*\(/, 5],
  ["kotlin", /\bval\s+\w+\s*[:=]|\bdata class\b|println\(/, 3],
  ["swift", /\bfunc\s+\w+\s*\(/, 4],
  [
    "swift",
    /\bguard\s+let\b|\bimport\s+(SwiftUI|Foundation|UIKit)\b|\bvar\s+body\s*:\s*some\b/,
    6,
  ],
  ["swift", /\blet\s+\w+\s*[:=]/, 1],
  ["go", /^\s*package\s+\w+\s*$/m, 6],
  ["go", /\bfunc\s+(\(\w+\s+\*?\w+\)\s*)?\w+\(/, 4],
  ["go", /:=|\bfmt\.\w+|\bgo\s+func\b|\bchan\b/, 3],
  ["rust", /\bfn\s+\w+(<.*>)?\s*\(/, 5],
  [
    "rust",
    /\blet\s+mut\b|\bimpl\b|\bpub\s+fn\b|println!|->\s*Result<|&str\b|\buse\s+std::/,
    4,
  ],
  ["c", /^\s*#include\s*<\w+\.h>/m, 6],
  ["c", /\bprintf\(|\bmalloc\(|\bint\s+main\s*\(/, 3],
  ["cpp", /^\s*#include\s*<(iostream|vector|string|memory|map)>/m, 7],
  ["cpp", /std::|cout\s*<<|\btemplate\s*<|\bnullptr\b/, 4],
  ["csharp", /\busing\s+System(\.\w+)*;/, 7],
  [
    "csharp",
    /\bnamespace\s+\w+|\bConsole\.WriteLine|\bpublic\s+async\s+Task\b|\bvar\s+\w+\s*=\s*new\b/,
    4,
  ],
  ["ruby", /^\s*def\s+\w+[?!]?(\(.*\))?\s*$/m, 5],
  ["ruby", /^\s*end\s*$/m, 3],
  ["ruby", /\bputs\b|\battr_accessor\b|\.each\s+do\s*\|/, 4],
  ["php", /<\?php/, 10],
  ["php", /\$\w+\s*=|->\w+\(|\becho\b/, 2],
  [
    "dart",
    /\bvoid\s+main\(\)|\bWidget\s+build\(|\bfinal\s+\w+\s+\w+\s*=|\bimport\s+'package:/,
    5,
  ],
  [
    "lua",
    /\blocal\s+\w+\s*=|\bfunction\s+[\w.:]+\(|\bthen\b[\s\S]*\bend\b|\belseif\b/,
    3,
  ],
  ["bash", /^#!\/(usr\/)?bin\/(env\s+)?(ba|z)?sh/m, 10],
  [
    "bash",
    /^\s*(sudo|apt|brew|npm|npx|yarn|pnpm|git|cd|ls|echo|export|curl|docker)\s/m,
    4,
  ],
  ["bash", /\$\{?\w+\}?|\bfi\b|\bdone\b|\|\s*grep\b/, 2],
  [
    "powershell",
    /\$\w+\s*=\s*Get-\w+|\bWrite-Host\b|\b(Get|Set|New)-[A-Z]\w+/,
    7,
  ],
  [
    "sql",
    /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE)\b/i,
    5,
  ],
  ["sql", /\b(FROM|WHERE|JOIN|GROUP BY|ORDER BY)\b/, 3],
  [
    "css",
    /^[ \t]*[.#]?[a-z][\w-]*(?:(?:[ \t]*[,>+~][ \t]*|[ \t]+)[.#:]?[a-z][\w-]*)*[ \t]*\{[ \t]*$/im,
    3,
  ],
  ["css", /^\s*[\w-]+\s*:\s*[^;]+;\s*$/m, 3],
  ["css", /@media|@keyframes|!important/, 3],
  ["scss", /^\s*\$[\w-]+\s*:/m, 5],
  ["scss", /@mixin|@include|&:hover|&\./, 5],
  ["yaml", /^\s*[\w-]+:\s*[^{};]*$/m, 2],
  ["yaml", /^\s*-\s+[\w-]+:\s/m, 4],
  ["yaml", /^---\s*$/m, 3],
  ["yaml", /^[\w-]+:[ \t]*\n[ \t]+[\w-]+:/m, 3],
  ["toml", /^\s*\[[\w.-]+\]\s*$/m, 4],
  ["toml", /^\s*[\w-]+\s*=\s*("|\d|true|false|\[)/m, 3],
  ["markdown", /^#{1,6}\s+\S/m, 4],
  ["markdown", /^\s*[-*]\s+\S/m, 1],
  ["markdown", /\[[^\]]+\]\([^)]+\)|^```/m, 4],
  ["docker", /^\s*(FROM|RUN|COPY|WORKDIR|CMD|ENTRYPOINT|EXPOSE|ENV)\s/m, 5],
  ["diff", /^(\+\+\+|---)\s/m, 5],
  ["diff", /^@@\s.*\s@@/m, 8],
  ["graphql", /^\s*(query|mutation|subscription|fragment)\s+\w*\s*[({]/m, 7],
  ["graphql", /^\s*type\s+\w+\s*\{/m, 3],
];

export function detect(code) {
  const sample = code.slice(0, 6000);
  if (!sample.trim()) return "plain";
  const score = {};
  for (const [lang, re, w] of RULES) {
    if (re.test(sample)) score[lang] = (score[lang] || 0) + w;
  }
  // TS/TSX/JSX build on JavaScript: give them its points too.
  for (const sub of ["typescript", "jsx", "tsx"])
    if (score[sub] > 0) score[sub] += score.javascript || 0;
  if (score.tsx > 0 && !(score.typescript > 0)) score.tsx = 0;
  if (score.scss > 0) score.scss += score.css || 0;
  if (score.cpp > 0) score.cpp += score.c || 0;
  try {
    JSON.parse(sample);
    score.json = (score.json || 0) + 20;
  } catch {
    /* not JSON */
  }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : "plain";
}
