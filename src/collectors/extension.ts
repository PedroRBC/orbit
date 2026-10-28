import type { OrbitDB } from "../db/index";
import { connectionStatus, createCaptureJob, captureResult } from "../lib/extension";
import { CollectorError } from "./errors";
import type { RawItem } from "./types";

export async function collectThroughExtension(db: OrbitDB, sourceId: number, runId: number, signal?: AbortSignal, assertActive: () => void = () => {}): Promise<RawItem[]> {
  assertActive(); signal?.throwIfAborted();
  if (!connectionStatus(db).online) throw new CollectorError("browser_unavailable", "Abra o Helium com a extensão Orbit conectada. Faça o pareamento em /conectar; não é necessário exportar cookies.");
  const job = createCaptureJob(db, sourceId, runId);
  while (true) {
      assertActive(); signal?.throwIfAborted();
      const result = captureResult(db, job.id);
      if (result !== null) return result;
      await new Promise(resolve => setTimeout(resolve, 500));
  }
}
