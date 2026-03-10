import { JobsOptions, Queue } from "bullmq";
import { config } from "../config";

export const PROVISION_QUEUE_NAME = "provision-trial";

export interface ProvisionTrialJobPayload {
  trialRequestId: string;
}

export const provisionQueue = new Queue<ProvisionTrialJobPayload, void, "provision">(PROVISION_QUEUE_NAME, {
  connection: {
    url: config.redisUrl,
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: 200,
    removeOnFail: 200,
  },
});

export async function enqueueProvisionTrial(
  payload: ProvisionTrialJobPayload,
  opts?: JobsOptions,
): Promise<void> {
  try {
    await provisionQueue.add("provision", payload, {
      jobId: payload.trialRequestId,
      ...opts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("jobid")) {
      return;
    }
    throw error;
  }
}
