import Fastify from "fastify";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import formidable from "formidable";
import fs from "node:fs/promises";
import { openSession, closeSession } from "./session.js";
import { runIntents } from "./actions.js";
import { ExecuteRequest } from "./types.js";
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "..", "..", ".env") });
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || ".artifacts";
const UPLOADS_DIR = path.resolve(process.cwd(), ".uploads");
async function ensureDir(p) {
    await fs.mkdir(p, { recursive: true }).catch(() => { });
}
export async function buildServer() {
    const app = Fastify({ logger: false });
    app.get("/health", async () => ({ status: "ok", service: "executor" }));
    // Upload endpoint: store file under .uploads with a UUID, return a fileRef
    app.post("/uploads", async (req, reply) => {
        await ensureDir(UPLOADS_DIR);
        const form = formidable({
            multiples: false,
            uploadDir: UPLOADS_DIR,
            keepExtensions: true,
        });
        const res = await new Promise((resolve, reject) => {
            form.parse(req.raw, async (err, fields, files) => {
                if (err)
                    return reject(err);
                const anyFile = Object.values(files)[0]?.[0] || Object.values(files)[0];
                if (!anyFile || !("filepath" in anyFile))
                    return reject(new Error("no file"));
                const id = crypto.randomUUID();
                const ext = path.extname(anyFile.originalFilename || "") ||
                    path.extname(anyFile.filepath);
                const finalPath = path.join(UPLOADS_DIR, `${id}${ext}`);
                try {
                    await fs.rename(anyFile.filepath, finalPath);
                    resolve({ fileRef: `resume://${id}`, path: finalPath });
                }
                catch (e) {
                    reject(e);
                }
            });
        });
        return reply.send(res);
    });
    app.post("/execute", async (req, reply) => {
        const parsed = ExecuteRequest.safeParse(req.body);
        if (!parsed.success) {
            return reply
                .status(400)
                .send({ error: "invalid_request", detail: parsed.error.format() });
        }
        const { session_id, intents } = parsed.data;
        const session = await openSession(session_id);
        await ensureDir(session.dir);
        const results = await runIntents(session.page, session.dir, intents);
        return reply.send({
            session_id: session.id,
            results,
            artifacts: {
                dir: session.dir,
            },
        });
    });
    app.post("/close", async (req, reply) => {
        const body = req.body || {};
        const id = body.session_id;
        if (!id)
            return reply.status(400).send({ error: "session_id required" });
        await closeSession(id);
        return reply.send({ ok: true });
    });
    return app;
}
const isMain = (() => {
    try {
        const thisFile = fileURLToPath(import.meta.url);
        const argv1 = process.argv[1] ? path.resolve(process.argv[1]) : "";
        return path.normalize(thisFile) === path.normalize(argv1);
    }
    catch {
        return false;
    }
})();
if (isMain) {
    const PORT = Number(process.env.EXECUTOR_PORT || 7081);
    buildServer()
        .then((app) => app.listen({ host: "127.0.0.1", port: PORT }).then(() => {
        console.log(`[executor] listening on http://127.0.0.1:${PORT}`);
    }))
        .catch((e) => {
        console.error("[executor] failed to start:", e);
        process.exit(1);
    });
}
