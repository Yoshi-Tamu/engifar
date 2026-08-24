CREATE TABLE IF NOT EXISTS room (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(8) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'lobby',
  genre varchar(32) NOT NULL DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT room_code_format CHECK (code ~ '^[A-Z0-9]{6,8}$'),
  CONSTRAINT room_status_valid CHECK (status IN ('lobby', 'playing', 'results', 'closed'))
);

CREATE TABLE IF NOT EXISTS participant (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  display_name varchar(50) NOT NULL,
  role varchar(16) NOT NULL DEFAULT 'player',
  access_token_hash char(64) NOT NULL UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT participant_room_identity UNIQUE (id, room_id),
  CONSTRAINT participant_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT participant_role_valid CHECK (role IN ('host', 'player')),
  CONSTRAINT participant_leave_order CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS participant_one_host_per_room
  ON participant (room_id)
  WHERE role = 'host' AND left_at IS NULL;

CREATE INDEX IF NOT EXISTS participant_active_room_idx
  ON participant (room_id, joined_at)
  WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS game_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES room(id) ON DELETE CASCADE,
  session_number integer NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  question_count smallint NOT NULL DEFAULT 12,
  answer_time_seconds smallint NOT NULL DEFAULT 15,
  current_question_index smallint,
  question_started_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT game_session_room_identity UNIQUE (id, room_id),
  CONSTRAINT game_session_number_unique UNIQUE (room_id, session_number),
  CONSTRAINT game_session_status_valid
    CHECK (status IN ('active', 'completed', 'cancelled')),
  CONSTRAINT game_session_question_count_positive CHECK (question_count > 0),
  CONSTRAINT game_session_answer_time_positive CHECK (answer_time_seconds > 0),
  CONSTRAINT game_session_question_index_valid
    CHECK (
      current_question_index IS NULL OR
      current_question_index BETWEEN 0 AND question_count - 1
    ),
  CONSTRAINT game_session_finish_order CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS game_session_one_active_per_room
  ON game_session (room_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS session_participant (
  game_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  room_id uuid NOT NULL,
  display_name_snapshot varchar(50) NOT NULL,
  role_snapshot varchar(16) NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (game_session_id, participant_id),
  CONSTRAINT session_participant_session_room_fk
    FOREIGN KEY (game_session_id, room_id)
    REFERENCES game_session(id, room_id) ON DELETE CASCADE,
  CONSTRAINT session_participant_participant_room_fk
    FOREIGN KEY (participant_id, room_id)
    REFERENCES participant(id, room_id) ON DELETE RESTRICT,
  CONSTRAINT session_participant_name_not_blank CHECK (btrim(display_name_snapshot) <> ''),
  CONSTRAINT session_participant_role_valid CHECK (role_snapshot IN ('host', 'player')),
  CONSTRAINT session_participant_leave_order CHECK (left_at IS NULL OR left_at >= joined_at)
);

CREATE INDEX IF NOT EXISTS session_participant_participant_idx
  ON session_participant (participant_id, game_session_id);

CREATE TABLE IF NOT EXISTS answer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_session_id uuid NOT NULL,
  participant_id uuid NOT NULL,
  question_index smallint NOT NULL,
  selected_option smallint NOT NULL,
  response_time_ms integer,
  answered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT answer_session_participant_fk
    FOREIGN KEY (game_session_id, participant_id)
    REFERENCES session_participant(game_session_id, participant_id) ON DELETE CASCADE,
  CONSTRAINT answer_once_per_question
    UNIQUE (game_session_id, participant_id, question_index),
  CONSTRAINT answer_question_index_nonnegative CHECK (question_index >= 0),
  CONSTRAINT answer_selected_option_valid CHECK (selected_option BETWEEN 0 AND 3),
  CONSTRAINT answer_response_time_nonnegative
    CHECK (response_time_ms IS NULL OR response_time_ms >= 0)
);

CREATE INDEX IF NOT EXISTS answer_session_question_idx
  ON answer (game_session_id, question_index);
