import path from "node:path";
import fs from "node:fs/promises";

export async function writeJSON(baseDir: string, name: string, data: unknown) {
  const p = path.join(baseDir, `${name}.json`);
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf8");
  return p;
}

export async function writeCSV(baseDir: string, name: string, rows: any[]) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const csv = [headers.join(",")]
    .concat(
      rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))
    )
    .join("\n");
  const p = path.join(baseDir, `${name}.csv`);
  await fs.writeFile(p, csv, "utf8");
  return p;
}

export async function saveScreenshot(dir: string, label = "screenshot") {
  const filename = `${Date.now()}-${label.replace(/\s+/g, "_")}.png`;
  const p = path.join(dir, filename);
  return p;
}
