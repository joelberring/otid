import { provisionPinnedOperationalBackupTarget } from "../../src/operational-backup-pinned-target";

type WorkerInput = {
  checkpoint: "reservation-created" | "binding-synced";
  input: Parameters<typeof provisionPinnedOperationalBackupTarget>[0];
};

const parsed = JSON.parse(process.argv[2] ?? "null") as WorkerInput;
await provisionPinnedOperationalBackupTarget({
  ...parsed.input,
  testCheckpoint: async checkpoint => {
    if (checkpoint !== parsed.checkpoint) return;
    if (!process.send) throw new Error("IPC_CHECKPOINT_CHANNEL_REQUIRED");
    process.send({ checkpoint });
    await new Promise<void>(() => undefined);
  }
});
