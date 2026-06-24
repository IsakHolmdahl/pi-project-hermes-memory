/**
 * Pi Hermes Memory Extension
 *
 * Brings Hermes-style persistent memory and a learning loop to any Pi user.
 * After `pi install`, users get:
 *
 * 1. Persistent Memory — MEMORY.md + USER.md that survive across sessions
 * 2. Background Learning Loop — auto-saves notable facts every N turns
 * 3. Session-End Flush — saves memories before compaction/shutdown
 * 4. Auto-Consolidation — merges memory when full instead of erroring
 * 5. Correction Detection — immediate save on user corrections
 * 6. Procedural Skills — SKILL.md files for reusable procedures
 * 7. Tool-Call-Aware Nudge — review triggers on tool call count too
 * 8. /memory-insights — shows what's stored
 * 9. /memory-skills — lists procedural skills
 * 10. /memory-consolidate — manual consolidation trigger
 * 11. /memory-interview — onboarding interview to pre-fill user profile
 * 12. Context Fencing — <memory-context> tags prevent injection through stored memory
 * 13. Memory Aging — entry timestamps guide consolidation
 *
 * See docs/ROADMAP.md for full roadmap and Hermes competitive analysis.
 */

import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { MemoryStore } from "./store/memory-store.js";
import { SkillStore } from "./store/skill-store.js";
import { DatabaseManager } from "./store/db.js";
import { indexSession } from "./store/session-indexer.js";
import {
	scheduleSessionBackfill,
	waitForSessionBackfill,
	SESSION_BACKFILL_SHUTDOWN_TIMEOUT_MS,
} from "./handlers/session-backfill.js";
import {
	scheduleLiveSessionIndex,
	waitForLiveSessionIndex,
	SESSION_LIVE_INDEX_SHUTDOWN_TIMEOUT_MS,
} from "./handlers/session-live-index.js";
import { parseSessionFile } from "./store/session-parser.js";
import { registerMemoryTool } from "./tools/memory-tool.js";
import { registerSkillTool } from "./tools/skill-tool.js";
import { registerSessionSearchTool } from "./tools/session-search-tool.js";
import { registerMemorySearchTool } from "./tools/memory-search-tool.js";
import { setupBackgroundReview } from "./handlers/background-review.js";
import { setupSessionFlush } from "./handlers/session-flush.js";
import { registerInsightsCommand } from "./handlers/insights.js";
import {
	triggerConsolidation,
	registerConsolidateCommand,
} from "./handlers/auto-consolidate.js";
import { setupCorrectionDetector } from "./handlers/correction-detector.js";
import { registerSkillsCommand } from "./handlers/skills-command.js";
import { registerInterviewCommand } from "./handlers/interview.js";
import { registerIndexSessionsCommand } from "./handlers/index-sessions.js";
import { registerLearnMemoryCommand } from "./handlers/learn-memory.js";
import { registerPreviewContextCommand } from "./handlers/preview-context.js";
import { loadConfig } from "./config.js";

import { buildPromptContext } from "./prompt-context.js";

import { AGENT_ROOT, resolveLocalHermesDir } from "./paths.js";

export function resolveProjectSkillDiscovery(
	skillStore: SkillStore,
	_cwd?: string,
): { skillPaths: string[] } {
	skillStore.setProjectContext(null, null);
	return { skillPaths: [skillStore.getGlobalSkillsDir()] };
}

export function registerProjectSkillDiscoveryHandler(
	pi: Pick<ExtensionAPI, "on">,
	skillStore: SkillStore,
): void {
	pi.on("resources_discover", async (event, _ctx) => {
		return resolveProjectSkillDiscovery(
			skillStore,
			(event as { cwd?: string }).cwd,
		);
	});
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();

	const agentRoot = AGENT_ROOT;
	const memoryDir = config.memoryDir?.trim() || resolveLocalHermesDir();
	const store = new MemoryStore({ ...config, memoryDir: config.memoryDir });
	const skillStore = new SkillStore();
	const dbManager = new DatabaseManager(memoryDir);
	const sessionsDir = path.join(agentRoot, "sessions");

	const refreshSkillProjectContext = (cwd?: string) => {
		const resource = resolveProjectSkillDiscovery(skillStore, cwd);
		return {
			name: skillStore.getProjectName(),
			skillsDir: skillStore.getProjectSkillsDir(),
			resource,
		};
	};

	// ── 1. Load memory from disk on session start ──
	pi.on("session_start", async (_event, ctx) => {
		refreshSkillProjectContext(ctx.cwd);
		await skillStore.migrateLegacySkills();
		await skillStore.ensureDiscoveredRoots();
		await store.loadFromDisk();

		scheduleSessionBackfill(dbManager, sessionsDir, {
			notify: (message, level) => {
				const ui = (
					ctx as { ui?: { notify?: (message: string, level?: string) => void } }
				).ui;
				if (ui?.notify) {
					ui.notify(message, level);
				} else if (level === "error" || level === "warning") {
					console.warn(message);
				} else {
					console.info(message);
				}
			},
		});
	});

	registerProjectSkillDiscoveryHandler(pi, skillStore);

	// ── 2. Inject memory policy by default; legacy mode keeps full frozen memory blocks ──
	pi.on("before_agent_start", async (event, _ctx) => {
		const promptContext = await buildPromptContext(
			config,
			store,
		);

		if (promptContext) {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${promptContext}`,
			};
		}
	});

	// ── 3. Register the memory tool (with SQLite sync) ──
	registerMemoryTool(pi, store, dbManager);

	// ── 4. Register the skill tool ──
	registerSkillTool(pi, skillStore);

	// ── 5. Setup background learning loop (with tool-call-aware nudge) ──
	setupBackgroundReview(pi, store, config);

	// ── 6. Setup session-end flush ──
	setupSessionFlush(pi, store, config);

	// ── 7. Setup auto-consolidation (inject consolidator into stores) ──
	store.setConsolidator(async (target, signal) => {
		return triggerConsolidation(
			pi,
			store,
			target,
			signal,
			config.consolidationTimeoutMs,
			config,
		);
	});
	registerConsolidateCommand(
		pi,
		store,
		config.consolidationTimeoutMs,
		config,
	);

	// ── 8. Setup correction detection ──
	setupCorrectionDetector(
		pi,
		store,
		config,
		dbManager,
	);

	// ── 9. Register commands ──
	registerInsightsCommand(pi, store);
	registerSkillsCommand(pi, skillStore);
	registerInterviewCommand(pi, store);
	registerLearnMemoryCommand(pi);
	registerPreviewContextCommand(pi, store, config);

	// ── 10. Live session indexing ──
	pi.on("message_end", async (_event, ctx) => {
		scheduleLiveSessionIndex(dbManager, ctx.sessionManager, {
			onError: (err) =>
				console.warn(
					`⚠️ Live session indexing failed: ${err instanceof Error ? err.message : String(err)}`,
				),
		});
	});

	// ── 11. SQLite session search + extended memory ──
	registerSessionSearchTool(
		pi,
		dbManager,
		config.sessionSearch ?? { variant: "legacy" },
	);
	registerMemorySearchTool(pi, dbManager);
	registerIndexSessionsCommand(pi);

	// ── 12. Auto-index session on shutdown ──
	// Registered last, so this runs after the session-flush shutdown handler and
	// is the final DB activity. Closing here truncates the WAL via
	// PRAGMA wal_checkpoint(TRUNCATE); without it the WAL only grows to its
	// high-water mark and is never reclaimed across sessions.
	//
	// Ordering is safe: Pi's ExtensionRunner.emit() runs same-extension handlers
	// sequentially in registration order and awaits each one, so the flush above
	// fully completes before close() runs. WARNING: do not register another
	// DB-writing session_shutdown handler after this block — it would run after
	// close() and silently no-op.
	pi.on("session_shutdown", async (_event, ctx) => {
		try {
			const sessionFile = ctx.sessionManager.getSessionFile();
			if (sessionFile && require("node:fs").existsSync(sessionFile)) {
				const sessionData = parseSessionFile(sessionFile);
				if (sessionData) {
					indexSession(dbManager, sessionData);
				}
			}
		} catch {
			// Silent fail — don't block shutdown
		} finally {
			try {
				await Promise.all([
					waitForSessionBackfill(SESSION_BACKFILL_SHUTDOWN_TIMEOUT_MS),
					waitForLiveSessionIndex(SESSION_LIVE_INDEX_SHUTDOWN_TIMEOUT_MS),
				]);
			} catch {
				// Best effort only — shutdown should not be held up by indexing errors.
			}
			try {
				dbManager.close();
			} catch {
				/* best effort — never block shutdown */
			}
		}
	});
}
