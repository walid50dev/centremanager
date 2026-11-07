export function seedLoadTest(options?: { overwrite?: boolean; now?: Date }): Promise<boolean>;
export function buildLoadTestStore(base: Record<string, unknown>, now?: Date): Record<string, unknown>;
export function applyBundledLoadTest(): Promise<boolean>;
