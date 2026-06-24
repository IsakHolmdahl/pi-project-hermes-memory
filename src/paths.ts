import * as os from "node:os";
import * as path from "node:path";
import {
	LOCAL_HERMES_DIR,
	LOCAL_SKILLS_DIR,
	LOCAL_CONFIG_FILE,
} from "./constants.js";

export const AGENT_ROOT = resolveAgentRoot();

export function resolveAgentRoot(
	env: Record<string, string | undefined> = process.env,
): string {
	const configured = env.PI_CODING_AGENT_DIR?.trim();
	return configured
		? path.resolve(expandHome(configured))
		: path.join(os.homedir(), ".pi", "agent");
}

export function expandHome(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/") || input.startsWith("~\\")) {
		return path.join(os.homedir(), input.slice(2));
	}
	return input;
}

export function normalizeConfiguredMemoryDir(
	input: string,
	cwd: string = process.cwd(),
): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) return undefined;

	const expanded = expandHome(trimmed);
	if (path.isAbsolute(expanded)) return path.normalize(expanded);
	return path.resolve(cwd, expanded);
}

export function resolveLocalHermesDir(cwd: string = process.cwd()): string {
	return path.resolve(cwd, LOCAL_HERMES_DIR);
}

export function resolveLocalSkillsDir(cwd: string = process.cwd()): string {
	return path.resolve(cwd, LOCAL_SKILLS_DIR);
}

export function resolveLocalConfigPath(cwd: string = process.cwd()): string {
	return path.join(resolveLocalHermesDir(cwd), LOCAL_CONFIG_FILE);
}
