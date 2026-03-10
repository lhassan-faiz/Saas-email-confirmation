export const TRIAL_TYPES = ["m3u", "mag"] as const;
export type TrialType = (typeof TRIAL_TYPES)[number];

export const TRIAL_STATUSES = [
  "PENDING_EMAIL_VERIFICATION",
  "VERIFIED_PENDING_PROVISION",
  "PROVISIONED",
  "DELIVERED",
  "FAILED",
] as const;
export type TrialStatus = (typeof TRIAL_STATUSES)[number];

export interface TrialRequestRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  trial_type: TrialType;
  mac_address: string | null;
  status: TrialStatus;
  ip: string;
  user_agent: string | null;
  created_at: Date;
  updated_at: Date;
}

