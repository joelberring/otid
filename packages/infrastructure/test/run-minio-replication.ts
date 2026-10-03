import { withPinnedMinioReplication } from "./pinned-minio-replication-fixture";

// Opt-in compatibility runner. A passing run is not an operational backup/restore proof.
const [minioBinary, mcBinary] = process.argv.slice(2);
if (!minioBinary || !mcBinary) throw new Error("Pinned darwin-arm64 MinIO and mc binaries required");

await withPinnedMinioReplication({ minioBinary, mcBinary });
console.log("Pinned MinIO replication compatibility passed; exact synthetic historical PM versions remain readable after rule cleanup.");
