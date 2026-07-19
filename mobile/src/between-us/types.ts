export type PersonId = 'A' | 'B';

export type MoveType = 'position' | 'probe' | 'sharedClaim' | 'constraint' | 'gap';

export interface AgentMove {
  agentId: PersonId;
  moveType: MoveType;
  intent: string;
  payload: Record<string, unknown>;
  round: number;
  timestamp: number;
}

export interface SessionContext {
  name: string;
  situation: string;
  conversationType: ConversationType;
  desiredOutcome: string;
}

export type ConversationType =
  | 'Workplace'
  | 'Personal'
  | 'Financial'
  | 'Living together'
  | 'Other';

export interface IntakeAnswer {
  goodOutcome: string;
  hardLimit: string;
  wiggleRoom: string;
  personalContext: string;
}

export interface DebriefInsight {
  whatTheyCareAbout: string;
  whereThereIsAGap: string;
  whatAgentNeedsFromYou: string | null;
}

export interface VerdictResult {
  sharedAgreement: string;
  whatItMeansForYou: string;
  whatTheyGet: string;
}

export type Screen =
  | 'host'
  | 'join'
  | 'intake'
  | 'negotiation'
  | 'debrief'
  | 'verdict';
