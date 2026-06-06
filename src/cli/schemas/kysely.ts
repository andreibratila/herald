import { HERALD_DB_SCHEMA, renderKyselyPostgresSchema } from "../../internal/db-schema/index.js";

export const KYSELY_SCHEMA = renderKyselyPostgresSchema(HERALD_DB_SCHEMA);
