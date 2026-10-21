import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Isolated temp storage and permissive limits for tests. Set before any server module reads config.
process.env.UPSCALE_TMP_DIR ??= mkdtempSync(path.join(os.tmpdir(), "upscaler-test-"));
process.env.MIN_FREE_DISK_MB ??= "1";
process.env.DOWNLOAD_URL_SECRET ??= "test-secret-test-secret-test-secret-0123";
process.env.RATE_LIMIT_UPLOADS_PER_MINUTE ??= "1000";
process.env.RATE_LIMIT_REQUESTS_PER_MINUTE ??= "100000";
