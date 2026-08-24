export type WsEvent =
  | { type: "player_joined"; playerId: string; name: string }
  | { type: "player_left"; playerId: string }
  | { type: "field_selected"; field: "web" | "linebot" | "modeling" | "game" }
  | { type: "host_started" }
  | {
    type: "question_started";
    questionId: string;
    body: string;
    timeLimit: number;
  }
  | { type: "question_ended"; questionId: string; correctAnswer: string }
  | { type: "all_questions_done" }
  | { type: "launch_ready"; categoryScores: Record<string, number> };

export interface RoomState {
  hostId: string;
  players: string[];
  field: "web" | "linebot" | "modeling" | "game" | null;
  currentQuestionIndex: number;
  answeredPlayers: string[];
}
