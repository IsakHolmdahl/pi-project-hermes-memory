import { describe, it, before, after } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { MemoryStore } from "../src/store/memory-store.js";
import { SkillStore } from "../src/store/skill-store.js";
import { DatabaseManager } from "../src/store/db.js";
import { loadConfig } from "../src/config.js";

async function mkdtemp(prefix: string): Promise<string> {
	const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	return fs.realpath(tmp);
}

async function writeFile(filePath: string, content: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content, "utf-8");
}

async function rmdir(dir: string): Promise<void> {
	await fs.rm(dir, { recursive: true, force: true });
}

describe("local-only memory base", () => {
	let originalCwd: string;
	let tmpDir: string;

	before(async () => {
		originalCwd = process.cwd();
		tmpDir = await mkdtemp("pi-hermes-local-");
		process.chdir(tmpDir);
	});

	after(async () => {
		process.chdir(originalCwd);
		await rmdir(tmpDir);
	});

	it("MemoryStore creates .pi/hermes-memory in cwd", async () => {
		const store = new MemoryStore({
			memoryMode: "legacy-inject",
			memoryCharLimit: 1000,
			userCharLimit: 1000,
			projectCharLimit: 1000,
			nudgeInterval: 10,
			reviewEnabled: false,
			flushOnCompact: false,
			flushOnShutdown: false,
			flushMinTurns: 6,
			autoConsolidate: false,
			correctionDetection: false,
			failureInjectionEnabled: false,
			failureInjectionMaxAgeDays: 7,
			failureInjectionMaxEntries: 5,
			nudgeToolCalls: 15,
			consolidationTimeoutMs: 60000,
		});

		await store.loadFromDisk();
		await store.add("memory", "test note");

		const expectedDir = path.join(tmpDir, ".pi", "hermes-memory");
		const memoryFile = path.join(expectedDir, "MEMORY.md");
		const stat = await fs.stat(memoryFile);
		assert.ok(
			stat.isFile(),
			"MEMORY.md should be created under .pi/hermes-memory",
		);
	});

	it("loadConfig reads .pi/hermes-memory/config.json", async () => {
		const configPath = path.join(tmpDir, ".pi", "hermes-memory", "config.json");
		await writeFile(configPath, JSON.stringify({ nudgeInterval: 42 }));

		const config = loadConfig();
		assert.strictEqual(config.nudgeInterval, 42);
	});

	it("SkillStore uses .pi/skills in cwd", async () => {
		const store = new SkillStore();
		await store.ensureDiscoveredRoots();

		const expectedDir = path.join(tmpDir, ".pi", "skills");
		const stat = await fs.stat(expectedDir);
		assert.ok(
			stat.isDirectory(),
			"skills directory should be under .pi/skills",
		);
		assert.strictEqual(store.getGlobalSkillsDir(), expectedDir);
	});

	it("DatabaseManager stores sessions.db under .pi/hermes-memory in cwd", () => {
		const db = new DatabaseManager();
		const expectedPath = path.join(
			tmpDir,
			".pi",
			"hermes-memory",
			"sessions.db",
		);
		assert.strictEqual(db.getPath(), expectedPath);
	});
});
