export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type ParticipantRole = "host" | "player";
export type SessionStatus = "active" | "completed" | "cancelled";

export interface RoomSummary {
  id: string;
  code: string;
  status: RoomStatus;
  genre: string;
  createdAt: string;
}

export interface ParticipantSummary {
  id: string;
  displayName: string;
  role: ParticipantRole;
  joinedAt: string;
}

export interface RoomDetail extends RoomSummary {
  participants: ParticipantSummary[];
}

export interface MembershipResult {
  room: RoomSummary;
  participant: ParticipantSummary;
  accessToken: string;
}

export interface GameSessionSummary {
  id: string;
  roomId: string;
  sessionNumber: number;
  status: SessionStatus;
  questionCount: number;
  answerTimeSeconds: number;
  currentQuestionIndex: number | null;
  questionStartedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AnswerSummary {
  id: string;
  gameSessionId: string;
  participantId: string;
  questionIndex: number;
  selectedOption: number;
  responseTimeMs: number;
  answeredAt: string;
}

export interface GameRepository {
  healthCheck(): Promise<void>;
  createRoom(displayName: string): Promise<MembershipResult>;
  joinRoom(code: string, displayName: string): Promise<MembershipResult>;
  getRoom(code: string): Promise<RoomDetail>;
  startSession(code: string, accessToken: string): Promise<GameSessionSummary>;
  startQuestion(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
  ): Promise<GameSessionSummary>;
  submitAnswer(
    sessionId: string,
    accessToken: string,
    questionIndex: number,
    selectedOption: number,
  ): Promise<AnswerSummary>;
  completeSession(sessionId: string, accessToken: string): Promise<GameSessionSummary>;
}
