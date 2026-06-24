import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import {
	resolveProjectSkillDiscovery,
	registerProjectSkillDiscoveryHandler,
} from "../../src/index.js";
import { SkillStore } from "../../src/store/skill-store.js";

describe("resources_discover skill path resolution", () => {
	it("registers resources_discover and returns skillPaths from handler", async () => {
		const store = new SkillStore({
			globalSkillsDir: "/tmp/global-skills",
			projectSkillsDir: null,
			projectName: null,
			legacySkillsDir: "/tmp/legacy-skills",
			migrationSentinelPath: "/tmp/.skills-migrated",
		});

		const handlers: Record<string, Function> = {};
		const pi = {
			on: (event: string, handler: Function) => {
				handlers[event] = handler;
			},
		} as any;

		registerProjectSkillDiscoveryHandler(pi, store);
		assert.ok(typeof handlers.resources_discover === "function");

		const result = await handlers.resources_discover(
			{ cwd: "/tmp/demo-repo" },
			{},
		);
		assert.deepStrictEqual(result, { skillPaths: ["/tmp/global-skills"] });
	});

	it("returns local skillPaths and clears project skill context", () => {
		const store = new SkillStore({
			globalSkillsDir: "/tmp/global-skills",
			projectSkillsDir: null,
			projectName: null,
			legacySkillsDir: "/tmp/legacy-skills",
			migrationSentinelPath: "/tmp/.skills-migrated",
		});

		const resource = resolveProjectSkillDiscovery(store, "/tmp/demo-repo");

		assert.deepStrictEqual(resource, { skillPaths: ["/tmp/global-skills"] });
		assert.strictEqual(store.getProjectName(), null);
		assert.strictEqual(store.getProjectSkillsDir(), null);
	});

	it("returns global skill path when cwd is not a project", () => {
		const store = new SkillStore({
			globalSkillsDir: "/tmp/global-skills",
			projectSkillsDir: "/tmp/old-project",
			projectName: "old-project",
			legacySkillsDir: "/tmp/legacy-skills",
			migrationSentinelPath: "/tmp/.skills-migrated",
		});

		const resource = resolveProjectSkillDiscovery(store, os.homedir());

		assert.deepStrictEqual(resource, { skillPaths: ["/tmp/global-skills"] });
		assert.strictEqual(store.getProjectName(), null);
		assert.strictEqual(store.getProjectSkillsDir(), null);
	});
});
