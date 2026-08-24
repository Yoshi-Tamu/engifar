ALTER TABLE session_participant
  DROP CONSTRAINT session_participant_participant_room_fk;

ALTER TABLE session_participant
  ADD CONSTRAINT session_participant_participant_room_fk
  FOREIGN KEY (participant_id, room_id)
  REFERENCES participant(id, room_id)
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM answer a
    JOIN game_session gs ON gs.id = a.game_session_id
    WHERE a.question_index >= gs.question_count
  ) THEN
    RAISE EXCEPTION 'existing answers contain an out-of-range question_index'
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'answer_question_index_within_session';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_answer_question_index()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_question_count smallint;
BEGIN
  SELECT question_count
  INTO session_question_count
  FROM game_session
  WHERE id = NEW.game_session_id;

  IF session_question_count IS NOT NULL AND NEW.question_index >= session_question_count THEN
    RAISE EXCEPTION 'question_index % is outside the session question range', NEW.question_index
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'answer_question_index_within_session';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER answer_question_index_within_session
BEFORE INSERT OR UPDATE OF game_session_id, question_index ON answer
FOR EACH ROW
EXECUTE FUNCTION enforce_answer_question_index();

CREATE OR REPLACE FUNCTION enforce_game_session_question_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM answer
    WHERE game_session_id = NEW.id
      AND question_index >= NEW.question_count
  ) THEN
    RAISE EXCEPTION 'question_count % excludes an existing answer', NEW.question_count
      USING
        ERRCODE = '23514',
        CONSTRAINT = 'answer_question_index_within_session';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER game_session_question_count_covers_answers
BEFORE UPDATE OF question_count ON game_session
FOR EACH ROW
EXECUTE FUNCTION enforce_game_session_question_count();
