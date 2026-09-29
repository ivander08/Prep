import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const dir = join(tmpdir(), `probe_go_${crypto.randomUUID()}`);
await mkdir(dir, { recursive: true });
const file = join(dir, "main.go");
await writeFile(file, `package main
import "fmt"
func main() { fmt.Println("ok") }
`, "utf8");
for (const detached of [false, true]) {
  const t0 = Date.now();
  const proc = Bun.spawn(["go", "run", file], { stdout: "pipe", stderr: "pipe", cwd: dir, detached });
  const [o, e] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  console.log(`detached=${detached} exit=${await proc.exited} ms=${Date.now() - t0} out=${JSON.stringify(o.trim())} err=${JSON.stringify(e.trim().slice(0, 120))}`);
}
await rm(dir, { recursive: true, force: true });
process.exit(0);
