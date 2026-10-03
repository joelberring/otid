export const workerStatus = "TASK_001_PLACEHOLDER" as const;

if (process.env.NODE_ENV !== "test") console.log(`O-Tid worker: ${workerStatus}`);
