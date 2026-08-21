/**
 * dsh-pzds-tool — host half (静态插件版).
 *
 * Registers the `pzds-tool` settings namespace as the control channel:
 *  - client writes `command: "start"|"stop"` + `params` (表单参数)
 *  - host watches the namespace, spawns the runner subprocess, and writes
 *    back `status` / `result` / `history` for the browser half to render.
 *
 * The runner lives at C:\Users\16667\Desktop\dsh\dsh-desktop\pzds_plugin\runner.js
 * and is spawned with the system node executable — same as the dynamic
 * plugin version, just mounted statically so it survives restarts.
 */
import fs from "node:fs";
import path from "node:path";
import z from "@deepseek-ai/schemastery";
import { settingsNamespace } from "@deepseek-ai/dsh-settings";

export const name = "dsh-pzds-tool";

/** Settings namespace this plugin owns (exposed to the Web client via the api-proxy whitelist). */
export const SETTINGS_NAMESPACE = "pzds-tool";

/** Control/state fields stored in the namespace. */
export const Config = z.object({
  /** Form parameters forwarded to the runner (free-form JSON). */
  params: z.any().default({}),
  /** Client → host command: "" | "start" | "stop". */
  command: z.string().default(""),
  /** Host → client progress snapshot: { phase, message, done, total, current }. */
  status: z.any().default({}),
  /** Host → client final result: { reportPath, count, totalScore, totalPrice, top }. */
  result: z.any().default(null),
  /** Host → client history list. */
  history: z.any().default([]),
});

const NODE = "C:\\Users\\16667\\AppData\\Roaming\\DeepSeek Harness\\dsh-runtime\\node.exe";
const PLUGIN_DIR = "C:\\Users\\16667\\Desktop\\dsh\\dsh-desktop\\pzds_plugin";
const RUNNER = PLUGIN_DIR + "\\runner.js";
const PARAMS = PLUGIN_DIR + "\\params.json";
const PROGRESS = PLUGIN_DIR + "\\progress.json";
const RESULT = PLUGIN_DIR + "\\result.json";
const HISTORY = PLUGIN_DIR + "\\history.json";
const DATASETS = PLUGIN_DIR + "\\datasets";
const DATASETS_INDEX = DATASETS + "\\index.json";

/** Read a JSON file, tolerating absence. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return null;
  }
}

export function apply(ctx, config) {
  let currentProc = null;
  let running = false;
  let lastCommand = "";

  // 注册 pzds-tool 命名空间（唯一注册点！）。绝不能再额外 register——
  // dsh-settings 对重复注册抛 "already registered"，会把 scope.watch 毁掉
  // （固化版 host 从未生效的根因）。client 经 apiproxy mutate 写入后，
  // settings 服务的 commit 会直接通知 scope.watch。
  ctx.inject(["settings", "subprocess"], (sctx) => {
    const scope = sctx.settings.register(settingsNamespace(SETTINGS_NAMESPACE), Config, { base: config });
    const readSection = () => {
      try { return scope.get() || {}; } catch (e) { return {}; }
    };

    async function updateStatus(patch) {
      try {
        const current = readSection();
        await scope.update({ status: { ...(current.status || {}), ...patch } });
      } catch (e) {
        console.log("[pzds-tool] status update failed:", e && e.message);
      }
    }

    async function stopProc() {
      if (currentProc) {
        try { await currentProc.terminate(); } catch (e) {}
        currentProc = null;
      }
      running = false;
    }

    // 删除数据集（目录 + index 条目 + 报告文件），1 数据集 ↔ 1 报告
    function deleteDataset(id) {
      const idx = readJson(DATASETS_INDEX) || [];
      const item = idx.find((x) => x && x.id === id);
      const next = idx.filter((x) => x && x.id !== id);
      if (next.length === idx.length) return { ok: false, error: "未找到该数据集" };
      try {
        fs.writeFileSync(DATASETS_INDEX, JSON.stringify(next, null, 2), "utf8");
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
      const dir = path.join(PLUGIN_DIR, "datasets", id);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
      return { ok: true, deleted: idx.length - next.length };
    }

    async function startRun(params) {
      if (running) return;
      running = true;
      const merged = {
        pages: 2, minPrice: 1000, maxPrice: 5000, minScore: 0, sortBy: "score",
        genshinVersion: 6.8, srVersion: 4.4, decay: 3, baseFactor: 0.8,
        consProgression: 5, c1Factor: 0.5, zeroCons: true, includeResources: true,
        unboundMail: true, linkedSR: true, concurrency: 3,
        ...(params || {}),
      };
      try {
        fs.writeFileSync(PARAMS, JSON.stringify(merged), "utf8");
      } catch (e) {
        console.log("[pzds-tool] params write failed:", e && e.message);
      }
      try {
        const spec = {
          argv: [NODE, RUNNER, PARAMS],
          cwd: PLUGIN_DIR,
          stdio: { stdin: "ignore", stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 1024 * 1024 } },
          graceMs: 5000,
        };
        currentProc = sctx.subprocess.spawn(spec);
        // Poll progress.json while the runner is alive.
        const poll = setInterval(() => {
          if (!running) return; // runner 已结束：停止进度回写，避免竞态覆盖最终状态
          const prog = readJson(PROGRESS);
          if (prog) void updateStatus(prog);
        }, 1500);
        currentProc.done.then(async (outcome) => {
          clearInterval(poll);
          running = false;
          const result = readJson(RESULT);
          const history = readJson(DATASETS_INDEX) || []; // 数据集列表（1 数据集 ↔ 1 报告）
          const finalStatus = { phase: outcome.exitCode === 0 ? "finished" : "failed", message: outcome.exitCode === 0 ? (result && result.message) || "完成" : "runner 异常退出 " + outcome.exitCode };
          try {
            await scope.update({ status: finalStatus, result, history });
          } catch (e) {
            console.log("[pzds-tool] final update failed:", e && e.message);
          }
        }).catch(async (e) => {
          clearInterval(poll);
          running = false;
          await updateStatus({ phase: "failed", message: String(e && e.message || e) });
        });
      } catch (e) {
        running = false;
        await updateStatus({ phase: "failed", message: "spawn失败: " + String(e && e.message || e) });
      }
    }

    // 命令处理：client 发送 "start:<ts>" / "stop:<ts>" / "open:<path>" / "delete:<id>"。
    // 统一防重：处理完更新 lastCommand；host 自己的 settings.update 会再次触发
    // document-updated 回声，靠相同 command 直接 return 防止死循环。
    const handleCommand = async (cmd) => {
      if (cmd === lastCommand) return;
      lastCommand = cmd;
      if (cmd.startsWith("start:")) {
        await updateStatus({ phase: "starting", message: "准备中..." });
        await startRun(readSection().params);
      } else if (cmd.startsWith("stop:")) {
        await stopProc();
        await updateStatus({ phase: "stopped", message: "已停止" });
      } else if (cmd.startsWith("open:")) {
        const p = cmd.slice(5).trim();
        if (p) {
          try {
            const spec = {
              argv: ["cmd.exe", "/c", "start", "", p],
              cwd: PLUGIN_DIR,
              stdio: { stdin: "ignore", stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
              graceMs: 3000,
            };
            const proc = sctx.subprocess.spawn(spec);
            await proc.done;
          } catch (e) {
            console.log("[pzds-tool] open report failed:", e && e.message);
          }
        }
      } else if (cmd.startsWith("delete:")) {
        const id = cmd.slice(7).trim();
        const res = id ? deleteDataset(id) : { ok: false, error: "缺少id" };
        try {
          await scope.update({
            history: readJson(DATASETS_INDEX) || [],
            status: { phase: res.ok ? "history-deleted" : "failed", message: res.ok ? "已删除数据集 " + id : (res.error || "删除失败") },
          });
        } catch (e) {
          console.log("[pzds-tool] delete update failed:", e && e.message);
        }
      } else if (cmd === "") {
        lastCommand = "";
      }
    };

    // 命名空间变更（client 经 apiproxy 写入，commit 时通知 watcher）驱动命令处理
    scope.watch(async () => {
      await handleCommand(readSection().command || "");
    });
    // 启动时清掉 client 残留的未处理命令（如历史点击留下的 open:/start:/delete:），
    // 避免重启后自动执行它们（只应由用户主动点击触发）。
    void scope.update({ command: "" }).catch(() => {});
  });
}
