// Copies the Python engine (src/api/metaheuristics) into public/py/ so the in-browser
// engine (Pyodide in a Web Worker) runs exactly the same code as the FastAPI server.
// Runs automatically before `npm run dev` and `npm run build`.
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = "src/api/metaheuristics";
const dst = "public/py/metaheuristics";
rmSync("public/py", { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
const files = readdirSync(src).filter((f) => f.endsWith(".py"));
for (const f of files) copyFileSync(join(src, f), join(dst, f));
writeFileSync("public/py/manifest.json", JSON.stringify(files));
console.log(`copy-py: ${files.length} Python files -> ${dst}`);
