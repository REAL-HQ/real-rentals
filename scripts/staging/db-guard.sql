-- Prepend to EVERY staging SQL script. Refuses unless connected to the approved staging database.
DO $$ DECLARE s text := (SELECT system_identifier::text FROM pg_control_system()); BEGIN
  IF s IN ('7642734024280108049' /* production */, '7692130048193495360' /* old staging, leave untouched */)
     OR s <> '__NEW_STAGING_SYSTEM_ID__' THEN
    RAISE EXCEPTION 'refused: system id % is not the approved staging id', s; END IF; END $$;
