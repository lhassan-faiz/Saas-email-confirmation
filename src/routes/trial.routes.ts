import { FastifyInstance } from "fastify";
import { TrialController } from "../controllers/trial.controller";

const trialController = new TrialController();

export async function trialRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/request",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    trialController.requestTrial.bind(trialController),
  );

  app.post(
    "/verify-otp",
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: "1 minute",
        },
      },
    },
    trialController.verifyOtp.bind(trialController),
  );

  app.get(
    "/status/:requestId",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    trialController.getTrialStatus.bind(trialController),
  );
}
