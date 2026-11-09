export declare const REVIEW_MODES: readonly ["adversarial", "lean"];
export declare const DEFAULT_REVIEW_MODE: "adversarial" | "lean";
export declare function resolveReviewMode(env?: NodeJS.ProcessEnv): "adversarial" | "lean";
export declare function composeReviewerInstructions(agentDir: string, mode: "adversarial" | "lean"): string;
