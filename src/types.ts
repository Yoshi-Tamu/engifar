export type RoomStatus = "lobby" | "playing" | "results" | "closed";
export type ParticipantRole = "host" | "player";
export type SessionStatus = "active" | "completed" | "cancelled";
export type GameGenre = "web" | "linebot" | "modeling" | "game";

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
  /** 他の参加者へ自分のプロフィール(名前・スコア)を共有結果で公開するかどうか。既定は公開。 */
  isProfilePublic?: boolean;
}

export interface RoomDetail extends RoomSummary {
  participants: ParticipantSummary[];
  activeSession: GameSessionSummary | null;
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
  choiceOrderVersion: number;
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

export interface SessionResultAnswer {
  questionIndex: number;
  selectedOption: number;
  responseTimeMs: number;
}

export interface SessionResultParticipantSource {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  isProfilePublic: boolean;
  answers: SessionResultAnswer[];
}

export interface SessionResultSource {
  session: GameSessionSummary;
  requesterParticipantId: string;
  participants: SessionResultParticipantSource[];
}

export interface ParticipantQuizResult {
  participantId: string;
  displayName: string;
  role: ParticipantRole;
  /** 本人の結果としてレスポンスへ含める場合のみ設定される。他参加者向けの一覧からは取り除かれる。 */
  isProfilePublic?: boolean;
  answeredCount: number;
  correctCount: number;
  power: number;
  safety: number;
  averageResponseTimeMs: number | null;
  categoryScores: Record<string, number>;
}

export interface SessionResults {
  sessionId: string;
  questionCount: number;
  personal: ParticipantQuizResult;
  team: {
    participantCount: number;
    answeredCount: number;
    possibleAnswerCount: number;
    completionRate: number;
    power: number;
    safety: number;
    categoryScores: Record<string, number>;
  };
  participants: ParticipantQuizResult[];
}

export interface AuthenticatedParticipant {
  roomId: string;
  participant: ParticipantSummary;
}

export interface GameRepository {
  healthCheck(): Promise<void>;
  createRoom(displayName: string): Promise<MembershipResult>;
  joinRoom(code: string, displayName: string): Promise<MembershipResult>;
  getRoom(code: string): Promise<RoomDetail>;
  /** WebSocket接続時に (roomCode, accessToken) から参加者と部屋(roomId)を特定するための認証。 */
  authenticateParticipant(roomCode: string, accessToken: string): Promise<AuthenticatedParticipant>;
  /** ホストが分野を選ぶ。部屋がlobby状態の間だけ許可される。 */
  selectGenre(code: string, accessToken: string, genre: GameGenre): Promise<RoomSummary>;
  /** 参加者が自分のプロフィール公開・非公開を切り替える。ロビー・ゲーム中いつでも呼べる。 */
  setProfileVisibility(
    code: string,
    accessToken: string,
    isProfilePublic: boolean,
  ): Promise<ParticipantSummary>;
  startSession(
    code: string,
    accessToken: string,
    questionCount: number,
    answerTimeSeconds: number,
  ): Promise<GameSessionSummary>;
  /** 参加者トークンを検証し、その参加者が所属するゲームセッションを取得する。 */
  getSessionForParticipant(
    sessionId: string,
    accessToken: string,
    reviewTimeSeconds?: number,
  ): Promise<GameSessionSummary>;
  /** 完了済みセッションの参加者と回答を、共有結果の集計用に取得する。 */
  getSessionResultSource(
    sessionId: string,
    accessToken: string,
  ): Promise<SessionResultSource>;
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

  /**
   * サーバー主導の進行ループ専用(トークン不要)。ホストではなくサーバー自身が
   * 制限時間経過を検知して次の問題に進めるために使う。
   * fromIndexの時点からすでに状態が変わっていた場合(ホストが手動操作した等)はnullを返し、何もしない。
   */
  advanceQuestionAutomatically(
    sessionId: string,
    fromIndex: number,
  ): Promise<GameSessionSummary | null>;
  /** サーバー主導の進行ループ専用(トークン不要)。最後の問題が終わった時にセッションを完了させる。 */
  completeSessionAutomatically(sessionId: string): Promise<GameSessionSummary | null>;

  /** そのセッションにまだ残っている参加者全員が、指定した問題に回答済みかどうか。 */
  haveAllParticipantsAnswered(sessionId: string, questionIndex: number): Promise<boolean>;

  /**
   * WebSocketの切断(正常切断・ハートビート切れの両方)を検知した時に呼ぶ。
   * participant.left_at / session_participant.left_at を更新する。
   * すでに離脱済みだった場合はnullを返す(二重処理の防止)。
   */
  markParticipantDisconnected(participantId: string): Promise<{ roomId: string } | null>;

  /**
   * 全参加者が離脱済みで、最後の離脱からolderThanMs以上経過した部屋を削除する(定期クリーンアップ用)。
   * room行を削除すると、participant/game_session以下はON DELETE CASCADEで連動して削除される。
   * 削除した部屋のIDの配列を返す。
   */
  deleteExpiredEmptyRooms(olderThanMs: number): Promise<string[]>;
}
